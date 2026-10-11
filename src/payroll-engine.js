// Payroll engine - ported from lib/payroll/engine.ts, workflow.ts and
// estimate.ts. The TAX/FORMULA MATH IS IDENTICAL to the original; only the
// data-fetching layer changed, from async Prisma queries to synchronous
// lookups against the in-memory `db` object (see db.js).

(function (root) {
  const isNode = typeof module !== "undefined" && module.exports;
  // In Node these come from require(); in the browser tax-engine.js,
  // rule-configs.js, dates.js and db.js are loaded as plain <script> tags
  // before this file, so their top-level function declarations are already
  // attached to `window` (= `root` here). We read them via `root.X` rather
  // than as bare identifiers, since a bare-identifier destructure of the
  // same name (e.g. `const { calculateTax } = { calculateTax }`) would
  // redeclare a same-scope local that shadows the global with a binding
  // still in its own temporal dead zone at that point.
  const { calculateTax, monthlyHraExemption } = isNode ? require("./tax-engine.js") : { calculateTax: root.calculateTax, monthlyHraExemption: root.monthlyHraExemption };
  const { deriveAgeCategory } = isNode ? require("./rule-configs.js") : { deriveAgeCategory: root.deriveAgeCategory };
  const { calendarToFyMonthIndex, daysInCalendarMonth, fyMonthIndexToCalendar, computeAge } = isNode ? require("./dates.js") : { calendarToFyMonthIndex: root.calendarToFyMonthIndex, daysInCalendarMonth: root.daysInCalendarMonth, fyMonthIndexToCalendar: root.fyMonthIndexToCalendar, computeAge: root.computeAge };
  const { newId, isCompanyPfApplicable, isCompanyEsiApplicable } = isNode
    ? require("./db.js")
    : { newId: root.newId, isCompanyPfApplicable: root.isCompanyPfApplicable, isCompanyEsiApplicable: root.isCompanyEsiApplicable };
  const { computePerquisitesTotal } = isNode ? require("./perquisites.js") : { computePerquisitesTotal: root.computePerquisitesTotal };
  const { computeLoanEmisDue, allocateLoanRecoveries, computeLoanPerquisite } = isNode
    ? require("./loans.js")
    : { computeLoanEmisDue: root.computeLoanEmisDue, allocateLoanRecoveries: root.allocateLoanRecoveries, computeLoanPerquisite: root.computeLoanPerquisite };
  const { computeMonthlyPT } = isNode ? require("./pt-slabs.js") : { computeMonthlyPT: root.computeMonthlyPT };
  const { resolveSalaryStructure } = isNode ? require("./formula-engine.js") : { resolveSalaryStructure: root.resolveSalaryStructure };

  const PERQ_CHECK_CODES = ["EMPLOYER_PF", "EMPLOYER_NPS", "EMPLOYER_SUPERANNUATION"];
  const BASIC_DA_CODES = ["BASIC", "DA"];
  // Sec 19 (old Sec 10(10AA)) / Rule 2BA's own salary definition for leave
  // encashment exemption is narrower-in-one-way, broader-in-another than
  // the plain "Basic+DA" used elsewhere in this file (HRA exemption,
  // Gratuity Act wages, the PF/NPS perquisite check): it adds turnover-based
  // commission, but only counts DA "to the extent it forms part of
  // retirement benefits." This app has no per-component flag distinguishing
  // turnover-based commission from a discretionary/performance one, or DA
  // that counts for retirement benefits from DA that doesn't - so it
  // assumes any COMMISSION component is turnover-based (the common case
  // where a Commission component exists at all) and that all of DA counts,
  // consistent with how Gratuity already treats DA. Flagged to the admin in
  // the Leave Encashment panel's own note so they can adjust manually if
  // either assumption doesn't hold for a given employee.
  const LEAVE_ENCASHMENT_SALARY_CODES = ["BASIC", "DA", "COMMISSION"];
  const NOT_PRORATED_DEDUCTION_CODES = ["PROFESSIONAL_TAX", "LWF", "LOAN_RECOVERY", "SALARY_ADVANCE"];
  const PAYROLL_STATUS_ORDER = ["DRAFT", "CALCULATED", "REVIEWED", "APPROVED", "LOCKED", "PAID"];

  function sumCodes(map, codes) {
    return codes.reduce((s, code) => s + (map[code] ?? 0), 0);
  }

  // PF Applicable / ESI Applicable on the employee master are the on/off
  // switch for these payheads: when unchecked, they're skipped even if the
  // salary structure (often populated from a shared company template) still
  // has a PF/ESI line - e.g. an employee exempt under the PF wage ceiling,
  // or on a contract with no ESI cover, without needing a one-off structure
  // just for them.
  // esiActiveOverride, when explicitly passed (true/false), decides
  // EMPLOYEE_ESI suppression directly instead of employee.esiApplicable -
  // used for ESI contribution-period continuity (see computeEmployeePayrollLine):
  // once ESI starts for a contribution period (1-Apr to 30-Sep, or 1-Oct to
  // 31-Mar), both sides must keep contributing through its end even if a
  // mid-period raise pushes wages over the ceiling and someone unticks the
  // flag early. Left undefined, every other caller (e.g.
  // estimateRegimeComparison, which has no specific month/period to reason
  // about) keeps the original flag-only behavior.
  // `company` (the employee's own) overrides both: a company not registered
  // under PF / ESI never calculates them, whatever the employee says.
  function isComponentSuppressed(employee, code, esiActiveOverride, company) {
    if (code === "EMPLOYEE_PF" || code === "EMPLOYER_PF") {
      return !isCompanyPfApplicable(company) || !!(employee && !employee.pfApplicable);
    }
    if (code === "EMPLOYEE_ESI" || code === "EMPLOYER_ESI") {
      if (!isCompanyEsiApplicable(company)) return true;
      const esiActive = esiActiveOverride !== undefined ? esiActiveOverride : !!(employee && employee.esiApplicable);
      return !esiActive;
    }
    return false;
  }

  function companyOf(db, employee) {
    return employee ? db.companies.find((c) => c.id === employee.companyId) : null;
  }

  /** FY months the employee is in service for (joining to leaving), as { calendarYear, calendarMonth }. */
  function serviceMonthsInFy(employee, fy) {
    const fyStartYear = Number(fy.startDate.slice(0, 4));
    const joinKey = employee.dateOfJoining ? employee.dateOfJoining.slice(0, 7) : "0000-00";
    const leaveKey = employee.dateOfLeaving ? employee.dateOfLeaving.slice(0, 7) : "9999-99";
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const cal = fyMonthIndexToCalendar(m, fyStartYear);
      const key = `${cal.calendarYear}-${String(cal.calendarMonth).padStart(2, "0")}`;
      if (key >= joinKey && key <= leaveKey) months.push(cal);
    }
    return months;
  }

  /** Every taxable perquisite for the FY: declared entries (gifts, car, meal vouchers, other) plus concessional employer loans valued from the loan register. */
  function annualPerquisites(db, employee, fy) {
    const entries = db.employeePerquisites.filter((p) => p.employeeId === employee.id && p.financialYearId === fy.id);
    const base = computePerquisitesTotal(entries, fy.startDate);
    const loanPerq = computeLoanPerquisite(db, employee.id, serviceMonthsInFy(employee, fy), base.rates);
    return { total: base.total + loanPerq.total, breakdown: [...base.breakdown, ...loanPerq.breakdown], rates: base.rates };
  }

  // Children's education / hostel allowance exemption (old regime only):
  // up to the per-child monthly limit, for at most 2 children, never more
  // than the allowance actually paid that month.
  function monthlyChildrenAllowanceExemption(earningsMap, declaration, limits) {
    if (!declaration) return 0;
    const maxChildren = limits.MAX_CHILDREN_ALLOWANCE ?? 2;
    const eduChildren = Math.min(declaration.childrenEducationCount || 0, maxChildren);
    const hostelChildren = Math.min(declaration.childrenHostelCount || 0, maxChildren);
    return (
      Math.min(earningsMap["CHILDREN_EDUCATION_ALLOWANCE"] || 0, eduChildren * (limits.CHILDREN_EDUCATION_PER_CHILD_MONTHLY ?? 3000)) +
      Math.min(earningsMap["HOSTEL_ALLOWANCE"] || 0, hostelChildren * (limits.HOSTEL_PER_CHILD_MONTHLY ?? 9000))
    );
  }

  function hasRecoverableLoans(db, employeeId) {
    return (db.employeeLoans || []).some((l) => l.employeeId === employeeId && l.status === "ACTIVE");
  }

  // Not "wages" for ESI (ESI Act Sec 2(22)): annual/periodic bonus,
  // travelling concession (LTA), and terminal payments (gratuity, leave
  // encashment) are excluded; everything else paid in cash this month -
  // including overtime, incentives and arrears - counts.
  const ESI_EXCLUDED_EARNING_CODES = ["BONUS", "LTA", "GRATUITY_TAXABLE", "LEAVE_ENCASHMENT_TAXABLE"];
  const STATUTORY_PF_RATE = 0.12;

  /** ESI contributions are rounded UP to the next whole rupee (ESI (Central) Rules, Rule 51). Rounded to paise first so float noise (e.g. 150.00000000000003) doesn't push an exact figure up a rupee. */
  function esiContribution(wages, rate) {
    return Math.ceil(Math.round(wages * rate * 100) / 100);
  }

  /**
   * Whether this structure's Employer PF is restricted to the PF wage
   * ceiling ("PF Capped"). Structures generated from a PF Capped template
   * carry an explicit `pfCapped` flag; for older/manual structures it's
   * inferred only when the PF figure is exactly 12% of a known ceiling AND
   * Basic+DA is above that ceiling - an unambiguous signature of capping.
   */
  function isStructurePfCapped(db, rawStructure, structureBasicDa, structurePf) {
    if (rawStructure.pfCapped != null) return !!rawStructure.pfCapped;
    if (!(structurePf > 0)) return false;
    return (db.wageCeilings || []).some((w) => Math.abs(structurePf - STATUTORY_PF_RATE * w.pfWageCeiling) < 1 && structureBasicDa > w.pfWageCeiling);
  }

  /** Whether a declared rent period (start/end dates, either optional) covers any part of the given calendar month - so HRA exemption only applies for months rent was actually being paid. */
  function isRentActiveInMonth(calendarYear, calendarMonth, rentStartDate, rentEndDate) {
    // Built in UTC, like currentMonthDate above, since rentStartDate/
    // rentEndDate are date-only strings (parsed as UTC midnight) - a
    // local-time construction would shift month boundaries by a day in
    // any timezone ahead of UTC and misjudge whether rent was active.
    const monthStart = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1));
    const monthEnd = new Date(Date.UTC(calendarYear, calendarMonth, 0));
    if (rentStartDate && monthEnd < new Date(rentStartDate)) return false;
    if (rentEndDate && monthStart > new Date(rentEndDate)) return false;
    return true;
  }

  /**
   * Projects a full FY's state-wise Professional Tax from a flat monthly
   * gross estimate - for estimateRegimeComparison, which (unlike an actual
   * payroll run) has no real month-by-month gross to compute PT from.
   * Mirrors computeEmployeePayrollLine's own per-month auto-PT logic
   * (including the senior-citizen exemption applying from the month the
   * employee actually reaches that age, and Maharashtra's February top-up),
   * but falls back to the structure's own fixed PT figure if the employee
   * has no state set, PT doesn't apply to them, or the state is
   * MANUAL/unrecognized - same as the real per-month calculation does.
   */
  function estimateAnnualPt(db, employee, fyStartYear, monthlyGrossEstimate, structureFallbackAnnual) {
    if (!(employee.ptApplicable && employee.state)) return structureFallbackAnnual;
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const { calendarYear: cy, calendarMonth: cm } = fyMonthIndexToCalendar(m, fyStartYear);
      const ageThatMonth = computeAge(employee.dob, new Date(Date.UTC(cy, cm - 1, 1)).toISOString());
      const autoPt = computeMonthlyPT(db.ptSlabs, employee.state, monthlyGrossEstimate, ageThatMonth, cm);
      if (autoPt === null) return structureFallbackAnnual;
      total += Math.round(autoPt);
    }
    return total;
  }

  /** Resolves the tax rule set in force for a FY+regime as of a date - mirrors lib/tax-engine/index.ts's DB resolver. */
  function getTaxRuleSetConfig(db, financialYearCode, regime, asOfDateIso) {
    const fy = db.financialYears.find((f) => f.code === financialYearCode);
    if (!fy) throw new Error(`Unknown financial year '${financialYearCode}'. Add it under Tax Rules first.`);
    const asOf = asOfDateIso ? new Date(asOfDateIso) : new Date(fy.endDate);
    const candidates = db.taxRuleSets
      .filter((r) => r.financialYearCode === financialYearCode && r.regime === regime && new Date(r.effectiveFrom) <= asOf)
      .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
    if (candidates.length === 0) {
      throw new Error(`No tax rule set found for FY ${financialYearCode} (${regime} regime) effective on or before ${asOf.toISOString().slice(0, 10)}. Configure it under Tax Rules.`);
    }
    return candidates[0];
  }

  /** Resolves the statutory PF/ESI wage ceiling config in force as of a date - same "latest row on or before the date" pattern as getTaxRuleSetConfig, but keyed only on effectiveFrom (there's no FY/regime split for these). Falls back to the oldest known config if asOfDateIso predates every seeded row, and throws only if db.wageCeilings is empty entirely (e.g. a very old backup restored before this existed and not yet re-seeded). */
  function getWageCeilingConfig(db, asOfDateIso) {
    const asOf = asOfDateIso ? new Date(asOfDateIso) : new Date();
    const sorted = (db.wageCeilings || []).slice().sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
    if (sorted.length === 0) throw new Error("No PF/ESI wage ceiling configured. Restore defaults under Settings, or add one.");
    return sorted.find((w) => new Date(w.effectiveFrom) <= asOf) || sorted[sorted.length - 1];
  }

  function getActiveStructure(db, employeeId, financialYearId, asOfDateIso, esiActiveOverride) {
    const asOf = new Date(asOfDateIso);
    const candidates = db.employeeSalaryStructures.filter(
      (s) =>
        s.employeeId === employeeId &&
        s.financialYearId === financialYearId &&
        s.isActive &&
        new Date(s.effectiveFrom) <= asOf &&
        (!s.effectiveTo || new Date(s.effectiveTo) >= asOf),
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
    const structure = candidates[0];
    const employee = db.employees.find((e) => e.id === employeeId);
    const company = companyOf(db, employee);
    return {
      raw: structure,
      annualCTC: structure.annualCTC,
      components: structure.components
        .filter((c) => !isComponentSuppressed(employee, c.componentCode, esiActiveOverride, company))
        .map((c) => ({ code: c.componentCode, category: c.category, monthlyAmount: c.monthlyAmount })),
    };
  }

  /**
   * Expands a company's reusable Salary Structure Template (CTC breakup
   * formulas, e.g. "40% of CTC" for Basic, "50% of BASIC" for HRA) into a
   * concrete set of components for one target annual CTC - the whole point
   * being an admin only has to type the CTC figure once per employee.
   * Gratuity (if the template carries a row for it) is always computed from
   * its own formula either way; `includeGratuityInCTC` only decides whether
   * it's counted as already inside the entered CTC (the template's own
   * other formulas are expected to account for it, e.g. a balancing
   * allowance that subtracts it) or added on top as extra employer cost -
   * reflected in the returned `totalCostToCompany`.
   */
  function generateStructureFromTemplate(db, templateId, annualCTC, asOfDateIso) {
    const template = db.salaryStructureTemplates.find((t) => t.id === templateId);
    if (!template) throw new Error("Salary structure template not found");
    return expandSalaryTemplate(db, template, annualCTC, asOfDateIso);
  }

  /** Core of generateStructureFromTemplate, taking the template object directly rather than an id - lets the template editor preview an as-yet-unsaved draft the same way. */
  function expandSalaryTemplate(db, template, annualCTC, asOfDateIso) {
    if (!(annualCTC > 0)) throw new Error("Enter a positive annual CTC to generate a structure");
    if (!template.components || template.components.length === 0) throw new Error("This template has no components defined yet");

    const feComponents = template.components.map((r) => ({
      code: r.componentCode,
      formula: r.formula && r.formula.trim() ? r.formula : null,
      fixedAnnualAmount: r.fixedAnnualAmount ?? 0,
    }));
    const resolved = resolveSalaryStructure(annualCTC, feComponents);

    // PF Capped: restricts Employer PF to the statutory wage ceiling (e.g.
    // 12% of Rs 15,000 = Rs 1,800/month, or Rs 25,000 = Rs 3,000/month from
    // 17-Sep-2026) instead of the template's own formula applied to full
    // Basic+DA - common practice to keep PF cost predictable. Below the
    // ceiling nothing changes (capped amount = uncapped amount). The
    // difference, if any, is redirected into Special Allowance so the CTC
    // this was generated for still ties out exactly - rather than silently
    // shrinking the employer's committed cost just because PF was capped.
    // The cap is applied to the WAGE BASE, not a hardcoded 12%, so it still
    // respects whatever rate the template's own Employer PF formula implies.
    let pfCapNote = null;
    if (template.pfCapped && resolved["EMPLOYER_PF"]) {
      const annualBasicPlusDa = (resolved["BASIC"]?.annualAmount ?? 0) + (resolved["DA"]?.annualAmount ?? 0);
      const uncappedAnnualPf = resolved["EMPLOYER_PF"].annualAmount;
      if (annualBasicPlusDa > 0) {
        const wageCeilingConfig = getWageCeilingConfig(db, asOfDateIso);
        const annualCeiling = wageCeilingConfig.pfWageCeiling * 12;
        const effectiveRate = uncappedAnnualPf / annualBasicPlusDa;
        const cappedAnnualPf = Math.round(effectiveRate * Math.min(annualBasicPlusDa, annualCeiling));
        const diffAnnual = uncappedAnnualPf - cappedAnnualPf;
        if (diffAnnual > 0) {
          resolved["EMPLOYER_PF"] = {
            ...resolved["EMPLOYER_PF"],
            annualAmount: cappedAnnualPf,
            monthlyAmount: Math.round((cappedAnnualPf / 12) * 100) / 100,
            formulaTrace: `${resolved["EMPLOYER_PF"].formulaTrace} - capped at PF wage ceiling Rs ${wageCeilingConfig.pfWageCeiling.toLocaleString("en-IN")}/month = Rs ${Math.round(cappedAnnualPf).toLocaleString("en-IN")}`,
          };
          pfCapNote = { diffAnnual, ceilingMonthly: wageCeilingConfig.pfWageCeiling };
          if (resolved["SPECIAL_ALLOWANCE"]) {
            resolved["SPECIAL_ALLOWANCE"] = {
              ...resolved["SPECIAL_ALLOWANCE"],
              annualAmount: resolved["SPECIAL_ALLOWANCE"].annualAmount + diffAnnual,
              monthlyAmount: Math.round(((resolved["SPECIAL_ALLOWANCE"].annualAmount + diffAnnual) / 12) * 100) / 100,
              formulaTrace: `${resolved["SPECIAL_ALLOWANCE"].formulaTrace} + Rs ${Math.round(diffAnnual).toLocaleString("en-IN")} redirected from PF Capped`,
            };
          }
        }
      }
    }

    const gratuityAnnual = resolved["GRATUITY"] ? resolved["GRATUITY"].annualAmount : 0;
    const totalCostToCompany = annualCTC + (template.includeGratuityInCTC ? 0 : gratuityAnnual);

    const components = template.components.map((r) => {
      const res = resolved[r.componentCode];
      const comp = db.salaryComponents.find((c) => c.code === r.componentCode);
      const monthlyAmount = Math.round(res.annualAmount / 12);
      return {
        componentId: comp ? comp.id : null,
        componentCode: r.componentCode,
        category: comp ? comp.category : null,
        monthlyAmount,
        annualAmount: monthlyAmount * 12,
        formulaTrace: res.formulaTrace,
      };
    });

    // No Special Allowance row existed in the template to redirect the PF
    // Capped difference into - synthesize one rather than silently letting
    // that money vanish from the generated structure (and from the CTC it
    // was supposed to add up to).
    if (pfCapNote && !template.components.some((r) => r.componentCode === "SPECIAL_ALLOWANCE")) {
      const comp = db.salaryComponents.find((c) => c.code === "SPECIAL_ALLOWANCE");
      const monthlyAmount = Math.round(pfCapNote.diffAnnual / 12);
      components.push({
        componentId: comp ? comp.id : null,
        componentCode: "SPECIAL_ALLOWANCE",
        category: comp ? comp.category : "EARNING",
        monthlyAmount,
        annualAmount: monthlyAmount * 12,
        formulaTrace: `Rs ${Math.round(pfCapNote.diffAnnual).toLocaleString("en-IN")} redirected from PF Capped (no Special Allowance row existed in this template)`,
      });
    }

    return {
      templateId: template.id,
      templateName: template.name,
      annualCTC,
      includeGratuityInCTC: !!template.includeGratuityInCTC,
      totalCostToCompany,
      components,
    };
  }

  /** Computes (without persisting) the full payroll + both-regime tax result for one employee in one run. */
  function computeEmployeePayrollLine(db, runId, employeeId, options) {
    options = options || {};
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error("Employee not found");
    const fy = db.financialYears.find((f) => f.id === run.financialYearId);
    const currentIndex = run.payrollMonthIndex;
    const daysInMonth = daysInCalendarMonth(run.calendarYear, run.calendarMonth);
    // Built directly in UTC (not via the local-time Date constructor + a
    // separate toISOString() conversion) so this lines up with how the
    // date-only strings it's compared against below (salary structure /
    // tax rule set effectiveFrom, DOB) are themselves parsed - those are
    // always read as UTC midnight per the ISO 8601 spec. Building it in
    // local time instead would, for any timezone ahead of UTC (e.g. IST,
    // UTC+5:30 - this is an India payroll app), shift "the 1st of the
    // month" back to the previous UTC day, making a structure effective
    // exactly that day look like it starts AFTER this run's date and
    // wrongly fail "No active salary structure".
    const currentMonthDate = new Date(Date.UTC(run.calendarYear, run.calendarMonth - 1, 1));
    const currentMonthDateIso = currentMonthDate.toISOString();

    // ESI contribution-period continuity (1-Apr to 30-Sep, 1-Oct to 31-Mar):
    // once ESI coverage actually applied in an earlier month of the SAME
    // period, it must keep applying through that period's end even if the
    // Employee Master's ESI Applicable flag gets unticked mid-period (the
    // real mistake this guards against - a raise crossing the wage ceiling
    // doesn't end coverage until the next period starts). Checked against
    // prior PROCESSED lines only, so it's a plain historical fact, not a
    // wage-ceiling re-derivation - the flag alone still decides whether
    // coverage starts in the first place.
    const esiPeriodStartIndex = currentIndex <= 6 ? 1 : 7;
    const esiContinuityActive = db.payrollRuns.some((r) => {
      if (r.financialYearId !== fy.id || r.payrollMonthIndex < esiPeriodStartIndex || r.payrollMonthIndex >= currentIndex) return false;
      const priorLine = r.lines.find((l) => l.employeeId === employeeId);
      return !!(priorLine && priorLine.metrics && priorLine.metrics.esiCoverageActiveThisMonth);
    });
    const company = companyOf(db, employee);
    const companyEsiApplicable = isCompanyEsiApplicable(company);
    const wageCeilingConfig = getWageCeilingConfig(db, currentMonthDateIso);

    // Structure without ESI lines first, to read the employee's rate of
    // wages - ESI coverage only STARTS (period start or joining) when the
    // monthly rate of wages, excluding overtime, is within the ceiling
    // (Rs 21,000; Rs 25,000 for a person with disability). Once started,
    // continuity above keeps it going to the period's end regardless.
    const structureWithoutEsi = getActiveStructure(db, employeeId, fy.id, currentMonthDateIso, false);
    if (!structureWithoutEsi) {
      throw new Error(`No active salary structure for employee ${employee.employeeCode} in FY ${fy.code}`);
    }
    const esiCeilingForEmployee = employee.isPersonWithDisability ? wageCeilingConfig.esiWageCeilingDisability : wageCeilingConfig.esiWageCeiling;
    const esiRateOfWages = structureWithoutEsi.components
      .filter((c) => c.category === "EARNING" && !ESI_EXCLUDED_EARNING_CODES.includes(c.code) && c.code !== "OVERTIME")
      .reduce((s, c) => s + c.monthlyAmount, 0);
    const esiEligibleByWages = esiRateOfWages <= esiCeilingForEmployee;
    const esiActiveThisMonth = companyEsiApplicable && (esiContinuityActive || (!!employee.esiApplicable && esiEligibleByWages));
    const esiIneligibleAboveCeiling = companyEsiApplicable && !!employee.esiApplicable && !esiActiveThisMonth && !esiEligibleByWages;

    const structure = esiActiveThisMonth ? getActiveStructure(db, employeeId, fy.id, currentMonthDateIso, true) : structureWithoutEsi;

    let lastActiveMonthIndex = 12;
    if (employee.dateOfLeaving && employee.dateOfLeaving >= fy.startDate && employee.dateOfLeaving <= fy.endDate) {
      const dol = new Date(employee.dateOfLeaving);
      lastActiveMonthIndex = calendarToFyMonthIndex(dol.getFullYear(), dol.getMonth() + 1);
    }

    // Days naturally "in service" this month, before LOP: the full month,
    // unless the employee joined or left partway through it - so a mid-month
    // joiner/leaver is correctly prorated even with zero LOP days entered.
    const monthStart = new Date(run.calendarYear, run.calendarMonth - 1, 1);
    const monthEnd = new Date(run.calendarYear, run.calendarMonth, 0);
    const joinDate = new Date(employee.dateOfJoining);
    const leaveDate = employee.dateOfLeaving ? new Date(employee.dateOfLeaving) : null;
    const serviceStart = joinDate > monthStart ? joinDate : monthStart;
    const serviceEnd = leaveDate && leaveDate < monthEnd ? leaveDate : monthEnd;
    const naturalDaysInService = Math.max(0, Math.round((serviceEnd - serviceStart) / 86400000) + 1);

    const lopDays = options.lopDays ?? 0;
    const daysWorked = options.daysWorked ?? Math.max(0, naturalDaysInService - lopDays);
    const prorationFactor = daysInMonth > 0 ? Math.max(0, Math.min(1, daysWorked / daysInMonth)) : 1;

    const earnings = {};
    let grossSalary = 0;
    for (const c of structure.components.filter((c) => c.category === "EARNING")) {
      const amt = Math.round(c.monthlyAmount * prorationFactor);
      earnings[c.code] = amt;
      grossSalary += amt;
    }

    // One-time taxable pay for this specific month (bonus, incentive, etc.) -
    // added to this month's earnings/gross/TDS calculation same as any other
    // earning, but NOT part of the salary structure, so it is never
    // projected into future months' annual-income estimate.
    for (const [code, amount] of Object.entries(options.variablePay || {})) {
      if (!amount) continue;
      earnings[code] = (earnings[code] || 0) + amount;
      grossSalary += amount;
    }

    const employerContributions = {};
    let totalEmployerContrib = 0;
    for (const c of structure.components.filter((c) => c.category === "EMPLOYER_CONTRIBUTION")) {
      const amt = Math.round(c.monthlyAmount * prorationFactor);
      employerContributions[c.code] = amt;
      totalEmployerContrib += amt;
    }

    const pfWages = sumCodes(earnings, BASIC_DA_CODES);

    // PF Capped: contribution is 12% of EARNED Basic+DA limited to the wage
    // ceiling in force this month - so LOP or a part month only reduces PF
    // once earned wages actually drop below the ceiling (scaling the fixed
    // structure figure by days worked would under-deduct statutory PF), and
    // a ceiling revision (e.g. Rs 15,000 -> Rs 25,000 from 17-Sep-2026)
    // takes effect without re-entering every structure. Uncapped PF keeps
    // the structure's own rate, which proration already applies to earned
    // Basic+DA.
    let pfCappedThisMonth = false;
    if (Object.prototype.hasOwnProperty.call(employerContributions, "EMPLOYER_PF")) {
      const structurePf = structure.components.filter((c) => c.code === "EMPLOYER_PF").reduce((s, c) => s + c.monthlyAmount, 0);
      const structureBasicDa = structure.components.filter((c) => BASIC_DA_CODES.includes(c.code)).reduce((s, c) => s + c.monthlyAmount, 0);
      if (isStructurePfCapped(db, structure.raw, structureBasicDa, structurePf)) {
        pfCappedThisMonth = true;
        const rate = structure.raw.pfRate || STATUTORY_PF_RATE;
        const cappedPf = Math.round(rate * Math.min(pfWages, wageCeilingConfig.pfWageCeiling));
        totalEmployerContrib += cappedPf - employerContributions["EMPLOYER_PF"];
        employerContributions["EMPLOYER_PF"] = cappedPf;
      }
    }

    // ESI: a percentage of this month's actual ESI wages (gross incl.
    // overtime/incentives, excl. bonus etc. - see ESI_EXCLUDED_EARNING_CODES),
    // computed whenever coverage applies (flag, or contribution-period
    // continuity), replacing any fixed figure typed into the structure.
    const esiWages = esiActiveThisMonth ? Object.entries(earnings).filter(([code]) => !ESI_EXCLUDED_EARNING_CODES.includes(code)).reduce((s, [, v]) => s + v, 0) : 0;
    // Employees whose average daily wage is Rs 176 or less pay no employee
    // share (ESIC, w.e.f. 1-Sep-2019) - the employer's 3.25% is still due.
    const esiAverageDailyWage = daysWorked > 0 ? esiWages / daysWorked : 0;
    const esiEmployeeShareExempt = esiActiveThisMonth && daysWorked > 0 && esiAverageDailyWage <= (wageCeilingConfig.esiEmployeeExemptDailyWage ?? 176);
    const employeeEsiThisMonth = esiActiveThisMonth && !esiEmployeeShareExempt ? esiContribution(esiWages, wageCeilingConfig.esiEmployeeRate ?? 0.0075) : 0;
    if (esiActiveThisMonth) {
      const employerEsi = esiContribution(esiWages, wageCeilingConfig.esiEmployerRate ?? 0.0325);
      totalEmployerContrib += employerEsi - (employerContributions["EMPLOYER_ESI"] || 0);
      employerContributions["EMPLOYER_ESI"] = employerEsi;
    }
    // Manual per-run tweak to an employer-contribution line (e.g. a one-off
    // top-up to Employer PF this month) - additive on top of the structure's
    // figure, same shape/intent as variablePay above, and equally never
    // projected into future months or written back to the structure.
    for (const [code, amount] of Object.entries(options.employerContribAdjustments || {})) {
      if (!amount) continue;
      employerContributions[code] = (employerContributions[code] || 0) + amount;
      totalEmployerContrib += amount;
    }

    const deductions = {};
    let totalDeductionsExclTds = 0;
    for (const c of structure.components.filter((c) => c.category === "DEDUCTION")) {
      const amt = NOT_PRORATED_DEDUCTION_CODES.includes(c.code) ? Math.round(c.monthlyAmount) : Math.round(c.monthlyAmount * prorationFactor);
      deductions[c.code] = amt;
      totalDeductionsExclTds += amt;
    }

    if (esiActiveThisMonth) {
      totalDeductionsExclTds += employeeEsiThisMonth - (deductions["EMPLOYEE_ESI"] || 0);
      deductions["EMPLOYEE_ESI"] = employeeEsiThisMonth;
    }

    // Employee PF contribution always matches Employer PF contribution
    // rupee-for-rupee (both are the statutory 12% of Basic+DA) - so it's
    // derived here from whatever Employer PF this structure resolved to
    // this month, rather than relying on a separately-entered structure
    // line that could drift out of sync. Only applies when the employee
    // actually has an Employer PF component (i.e. PF applies to them at
    // all - see isComponentSuppressed above); any manually-entered
    // EMPLOYEE_PF structure line is overridden by this.
    if (Object.prototype.hasOwnProperty.call(employerContributions, "EMPLOYER_PF")) {
      const mirroredEmployeePf = employerContributions["EMPLOYER_PF"];
      totalDeductionsExclTds += mirroredEmployeePf - (deductions["EMPLOYEE_PF"] || 0);
      deductions["EMPLOYEE_PF"] = mirroredEmployeePf;
    }

    // If the employee has a state set (for state-wise Professional Tax) and
    // PT applies to them, auto-compute PT from this month's gross salary and
    // the (editable) db.ptSlabs for that state, overriding whatever the
    // salary structure's own fixed PT component said. Falls back to the
    // structure's figure for MANUAL/unrecognized states.
    if (employee.ptApplicable && employee.state) {
      const employeeAgeThisMonth = computeAge(employee.dob, currentMonthDateIso);
      const autoPt = computeMonthlyPT(db.ptSlabs, employee.state, grossSalary, employeeAgeThisMonth, run.calendarMonth);
      if (autoPt !== null) {
        const roundedPt = Math.round(autoPt);
        totalDeductionsExclTds += roundedPt - (deductions["PROFESSIONAL_TAX"] || 0);
        deductions["PROFESSIONAL_TAX"] = roundedPt;
      }
    }

    // Manual per-run tweak to a deduction line (e.g. correcting one month's
    // PF or PT by a few rupees) - applied last so it has the final say even
    // over the auto-PT recompute just above, additive on top of whatever the
    // structure/auto-calc produced, and (like variablePay) scoped to this
    // month only.
    for (const [code, amount] of Object.entries(options.deductionAdjustments || {})) {
      if (!amount) continue;
      deductions[code] = (deductions[code] || 0) + amount;
      totalDeductionsExclTds += amount;
    }

    const basicPlusDaThisMonth = sumCodes(earnings, BASIC_DA_CODES);
    const employerPfNpsSuperThisMonth = sumCodes(employerContributions, PERQ_CHECK_CODES);
    const employerNpsThisMonth = employerContributions["EMPLOYER_NPS"] ?? 0;
    const ptThisMonth = deductions["PROFESSIONAL_TAX"] ?? 0;

    const declaration = db.investmentDeclarations.find((d) => d.employeeId === employeeId && d.financialYearId === fy.id) || null;
    const prevEmployer = db.previousEmployerIncomes.find((p) => p.employeeId === employeeId && p.financialYearId === fy.id) || null;
    const perquisitesAnnual = annualPerquisites(db, employee, fy).total;

    const oldConfig = getTaxRuleSetConfig(db, fy.code, "OLD", currentMonthDateIso);
    const newConfig = getTaxRuleSetConfig(db, fy.code, "NEW", currentMonthDateIso);
    const childrenAllowanceExemptionThisMonth = monthlyChildrenAllowanceExemption(earnings, declaration, oldConfig.deductionLimits);
    // Informational only (never auto-suppresses ESI) - lets the UI warn an
    // admin who's about to untick ESI Applicable mid-period that coverage
    // must continue anyway (see esiContinuityActive above) until the
    // contribution period actually ends.
    const esiCeilingExceededThisMonth = esiActiveThisMonth && grossSalary > esiCeilingForEmployee;

    const rentActiveThisMonth = isRentActiveInMonth(run.calendarYear, run.calendarMonth, declaration?.rentStartDate, declaration?.rentEndDate);
    // Rent paid to a landlord is a fixed monthly obligation, not something
    // that shrinks because the employee had LOP days that month - unlike
    // salary components, it must NOT be scaled by prorationFactor (the
    // projected-future-months loop below already treats it this way; this
    // keeps the current month consistent with that).
    const rentPaidThisMonth = rentActiveThisMonth ? declaration?.monthlyRent ?? 0 : 0;
    const hraExemptionThisMonth = monthlyHraExemption(
      { basic: basicPlusDaThisMonth, hraReceived: earnings["HRA"] ?? 0, rentPaid: rentPaidThisMonth, isMetro: declaration?.isMetroCity },
      oldConfig.hraConfig,
    );

    // --- YTD from prior processed months (derived from already-stored lines) ---
    const priorLines = [];
    for (const r of db.payrollRuns) {
      if (r.financialYearId !== fy.id || r.payrollMonthIndex >= currentIndex) continue;
      for (const l of r.lines) {
        if (l.employeeId === employeeId) priorLines.push(l);
      }
    }
    let ytdGross = 0, ytdBasicPlusDa = 0, ytdEmployerPfNpsSuper = 0, ytdEmployerNps = 0, ytdPt = 0, ytdHraExemption = 0, ytdTds = 0, ytdEmployeePf = 0, ytdChildrenAllowanceExemption = 0;
    for (const line of priorLines) {
      ytdChildrenAllowanceExemption += line.metrics.childrenAllowanceExemptionThisMonth ?? 0;
      ytdGross += line.grossSalary;
      ytdBasicPlusDa += sumCodes(line.earnings, BASIC_DA_CODES);
      ytdEmployerPfNpsSuper += sumCodes(line.employerContributions, PERQ_CHECK_CODES);
      ytdEmployerNps += line.employerContributions["EMPLOYER_NPS"] ?? 0;
      ytdPt += line.deductions["PROFESSIONAL_TAX"] ?? 0;
      ytdHraExemption += line.metrics.hraExemptionThisMonth ?? 0;
      ytdTds += line.tdsMonthly;
      ytdEmployeePf += line.deductions["EMPLOYEE_PF"] ?? 0;
    }

    // --- Project remaining months (after current, up to last active month) using the current structure ---
    const remainingProjectionMonths = Math.max(0, lastActiveMonthIndex - currentIndex);
    const projGrossPerMonth = structure.components.filter((c) => c.category === "EARNING").reduce((s, c) => s + c.monthlyAmount, 0);
    const structureEmployerMap = Object.fromEntries(structure.components.filter((c) => c.category === "EMPLOYER_CONTRIBUTION").map((c) => [c.code, c.monthlyAmount]));
    const structureDeductionMap = Object.fromEntries(structure.components.filter((c) => c.category === "DEDUCTION").map((c) => [c.code, c.monthlyAmount]));
    const structureEarningMap = Object.fromEntries(structure.components.filter((c) => c.category === "EARNING").map((c) => [c.code, c.monthlyAmount]));
    const projEmployerPfNpsSuperPerMonth = sumCodes(structureEmployerMap, PERQ_CHECK_CODES);
    const projEmployerNpsPerMonth = structureEmployerMap["EMPLOYER_NPS"] ?? 0;
    const projPtPerMonth = structureDeductionMap["PROFESSIONAL_TAX"] ?? 0;
    // Employee PF mirrors Employer PF (see the mirroring block above), so
    // future months are projected the same way: from the structure's
    // Employer PF line, not a separate Employee PF one.
    const projEmployeePfPerMonth = pfCappedThisMonth
      ? Math.round((structure.raw.pfRate || STATUTORY_PF_RATE) * Math.min(sumCodes(structureEarningMap, BASIC_DA_CODES), wageCeilingConfig.pfWageCeiling))
      : structureEmployerMap["EMPLOYER_PF"] ?? 0;
    const projBasicPlusDaPerMonth = sumCodes(structureEarningMap, BASIC_DA_CODES);
    // Projected HRA exemption is summed month-by-month (rather than a flat
    // per-month figure x remaining months) since a declared rent period can
    // start or end partway through the projection window - e.g. rent
    // starting next month, or a lease ending before the FY's last month.
    let projHraExemptionTotal = 0;
    const fyStartYear = new Date(fy.startDate).getFullYear();
    for (let m = currentIndex + 1; m <= lastActiveMonthIndex; m++) {
      const { calendarYear: cy, calendarMonth: cm } = fyMonthIndexToCalendar(m, fyStartYear);
      const rentActive = isRentActiveInMonth(cy, cm, declaration?.rentStartDate, declaration?.rentEndDate);
      projHraExemptionTotal += monthlyHraExemption(
        { basic: projBasicPlusDaPerMonth, hraReceived: structureEarningMap["HRA"] ?? 0, rentPaid: rentActive ? declaration?.monthlyRent ?? 0 : 0, isMetro: declaration?.isMetroCity },
        oldConfig.hraConfig,
      );
    }

    const annualGross = ytdGross + grossSalary + remainingProjectionMonths * projGrossPerMonth;
    const annualBasicPlusDa = ytdBasicPlusDa + basicPlusDaThisMonth + remainingProjectionMonths * projBasicPlusDaPerMonth;
    const annualEmployerPfNpsSuper = ytdEmployerPfNpsSuper + employerPfNpsSuperThisMonth + remainingProjectionMonths * projEmployerPfNpsSuperPerMonth;
    const annualEmployerNps = ytdEmployerNps + employerNpsThisMonth + remainingProjectionMonths * projEmployerNpsPerMonth;
    const annualPt = ytdPt + ptThisMonth + remainingProjectionMonths * projPtPerMonth;
    const annualHraExemption = ytdHraExemption + hraExemptionThisMonth + projHraExemptionTotal;
    const annualChildrenAllowanceExemption =
      ytdChildrenAllowanceExemption + childrenAllowanceExemptionThisMonth + remainingProjectionMonths * monthlyChildrenAllowanceExemption(structureEarningMap, declaration, oldConfig.deductionLimits);
    const employeePfThisMonth = deductions["EMPLOYEE_PF"] ?? 0;
    const annualEmployeePf = ytdEmployeePf + employeePfThisMonth + remainingProjectionMonths * projEmployeePfPerMonth;

    const remainingMonthsForTds = Math.max(1, Math.min(13 - currentIndex, lastActiveMonthIndex - currentIndex + 1));

    const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
    // Employee's own (statutory, mandatory) PF contribution qualifies for
    // deduction under Sec 123 (old 80C) same as the voluntary EPF/PPF/ELSS
    // etc. below - https://www.incometax.gov.in Sec 80C(2)(vi) treats a
    // contribution to a recognised PF the same as a PF contribution under
    // the Employees' Provident Funds Act, 1952.
    const section80C =
      (declaration?.lic ?? 0) + (declaration?.epf ?? 0) + (declaration?.ppf ?? 0) + (declaration?.elss ?? 0) +
      (declaration?.lifeInsurance ?? 0) + (declaration?.tuitionFees ?? 0) + (declaration?.housingLoanPrincipal ?? 0) +
      (declaration?.otherSection80C ?? 0) + (declaration?.section80CCC ?? 0) + (declaration?.section80CCD1 ?? 0) +
      annualEmployeePf;

    function buildInput(regime) {
      return {
        regime,
        ageCategory,
        grossSalaryCurrentEmployer: annualGross,
        perquisitesOther: perquisitesAnnual,
        employerNpsContribution: annualEmployerNps,
        employerPfNpsSuperContribution: annualEmployerPfNpsSuper,
        previousEmployerTaxableSalary: prevEmployer?.taxableSalary ?? 0,
        hraExemption: annualHraExemption,
        childrenAllowanceExemption: annualChildrenAllowanceExemption,
        ltaExemption: declaration?.ltaClaimed ?? 0,
        professionalTaxPaid: annualPt,
        selfOccupiedHomeLoanInterest: declaration?.homeLoanInterestSelfOccupied ?? 0,
        letOutAnnualValue: declaration?.letOutAnnualValue ?? 0,
        letOutMunicipalTax: declaration?.letOutMunicipalTax ?? 0,
        letOutHomeLoanInterest: declaration?.letOutHomeLoanInterest ?? 0,
        otherIncomeDeclared: 0,
        deductions: {
          section80C,
          section80CCD1B: declaration?.section80CCD1B ?? 0,
          section80CCD2Employer: annualEmployerNps,
          basicPlusDaAnnual: annualBasicPlusDa,
          section80DSelfBelow60: declaration?.section80DSelfBelow60 ?? 0,
          section80DParentsBelow60: declaration?.section80DParentsBelow60 ?? 0,
          section80DSelfAbove60: declaration?.section80DSelfAbove60 ?? 0,
          section80DParentsAbove60: declaration?.section80DParentsAbove60 ?? 0,
          section80E: declaration?.section80E ?? 0,
          section80EE: declaration?.section80EE ?? 0,
          section80EEA: declaration?.section80EEA ?? 0,
          section80UBelow80: declaration?.section80UBelow80 ?? 0,
          section80U80AndAbove: declaration?.section80U80AndAbove ?? 0,
          section80DDBelow80: declaration?.section80DDBelow80 ?? 0,
          section80DD80AndAbove: declaration?.section80DD80AndAbove ?? 0,
          donations80G: declaration?.donations80G ?? 0,
          otherDeductions: declaration?.otherDeductions ?? 0,
        },
        tdsAlreadyDeductedCurrentEmployer: ytdTds,
        tdsDeductedPreviousEmployer: prevEmployer?.tdsDeducted ?? 0,
        remainingMonthsInFY: remainingMonthsForTds,
      };
    }

    const oldResult = calculateTax(buildInput("OLD"), oldConfig);
    const newResult = calculateTax(buildInput("NEW"), newConfig);

    const regimeUsed = employee.taxRegime;
    const standardTdsMonthly = regimeUsed === "OLD" ? oldResult.monthlyTds : newResult.monthlyTds;
    // Optional alternate method (Setup > Tax Rules > TDS Calculation Method):
    // instead of spreading the remaining tax balance evenly over the
    // remaining months, this month's TDS is this month's share of total
    // annual tax PROPORTIONAL TO INCOME EARNED SO FAR - i.e. (total tax
    // liability / total annual gross) x (gross paid so far, including this
    // month) minus TDS already deducted this FY. Triggered only for a
    // month that would otherwise distort the even-spread method: a bonus
    // or arrears payment (a lump sum concentrated in one month, which
    // even-spread would otherwise average into every future month's TDS
    // too, under- or over-deducting along the way) or an employee's
    // joining month (where even-spread divides the full remaining tax by
    // every remaining month without regard to how little was actually
    // earned in a partial first month, which can deduct TDS exceeding
    // that month's own net pay).
    const usesProportionalTdsMethod = !!(db.payrollSettings && db.payrollSettings.useProportionalTdsForVariablePay);
    const hasBonusThisMonth = (earnings.BONUS || 0) > 0;
    const hasArrearsThisMonth = Object.entries(earnings).some(([code, amt]) => amt > 0 && (code === "ARREARS" || code.endsWith(ARREARS_CODE_SUFFIX)));
    const joiningDate = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null;
    const isJoiningMonth = !!(joiningDate && joiningDate.getUTCFullYear() === run.calendarYear && joiningDate.getUTCMonth() + 1 === run.calendarMonth);
    const useProportionalTdsThisMonth = usesProportionalTdsMethod && (hasBonusThisMonth || hasArrearsThisMonth || isJoiningMonth);
    const totalTaxLiabilityForRegime = regimeUsed === "OLD" ? oldResult.totalTaxLiability : newResult.totalTaxLiability;
    const proportionalTdsMonthly = annualGross > 0 ? Math.max(0, Math.round((totalTaxLiabilityForRegime / annualGross) * (ytdGross + grossSalary)) - ytdTds) : standardTdsMonthly;
    const computedTdsMonthly = useProportionalTdsThisMonth ? proportionalTdsMonthly : standardTdsMonthly;
    // An explicit manual TDS override (with its own required reason, checked
    // by the caller) replaces the engine's own figure outright for this
    // month only - unlike every other adjustment above, TDS has no
    // meaningful "delta on top of the computed value" since it isn't built
    // from independent line items. The tax calculation trace still shows
    // what the engine itself computed, so the override is never silent.
    const tdsOverridden = options.tdsOverride !== undefined && options.tdsOverride !== null && options.tdsOverride !== "";
    const tdsMonthly = tdsOverridden ? Math.round(Number(options.tdsOverride)) : computedTdsMonthly;
    let totalDeductions = totalDeductionsExclTds + tdsMonthly;

    // Loan EMIs (Loans & Advances register): a post-tax recovery, so it
    // never touches the tax computation above. Capped at the net pay left
    // after every other deduction - an unrecovered balance just stays
    // outstanding for later months. The whole balance falls due in the
    // employee's last month of service (Full & Final).
    let loanRecoveries = [];
    if (!options.skipLoanRecovery) {
      const isFinalMonth = !!employee.dateOfLeaving && lastActiveMonthIndex === currentIndex && employee.dateOfLeaving <= fy.endDate;
      const due = computeLoanEmisDue(db, employeeId, run.calendarYear, run.calendarMonth, run.id, isFinalMonth);
      if (due.length) {
        loanRecoveries = allocateLoanRecoveries(due, grossSalary - totalDeductions);
        const recovered = loanRecoveries.reduce((s, r) => s + r.amount, 0);
        if (recovered) {
          deductions["LOAN_RECOVERY"] = (deductions["LOAN_RECOVERY"] || 0) + recovered;
          totalDeductions += recovered;
        }
      }
    }
    const netSalary = grossSalary - totalDeductions;

    return {
      loanRecoveries,
      daysInMonth,
      daysWorked,
      lopDays,
      earnings,
      grossSalary,
      employerContributions,
      totalEmployerCost: grossSalary + totalEmployerContrib,
      deductions,
      tdsMonthly,
      computedTdsMonthly,
      tdsMethodUsed: useProportionalTdsThisMonth ? "PROPORTIONAL" : "STANDARD",
      tdsOverridden,
      totalDeductions,
      netSalary,
      regimeUsed,
      taxCalcSnapshot: { old: oldResult, new: newResult },
      metrics: { hraExemptionThisMonth, childrenAllowanceExemptionThisMonth, rentPaidThisMonth, prorationFactor, esiCoverageActiveThisMonth: esiActiveThisMonth, esiCeilingExceededThisMonth, esiIneligibleAboveCeiling, esiRateOfWages, esiEmployeeShareExempt, esiWages, pfWages, pfArrears: options.pfArrears || 0, pfCapped: pfCappedThisMonth, pfWageCeiling: wageCeilingConfig.pfWageCeiling },
    };
  }

  function isEmployeeEligibleForRun(employee, run) {
    if (run.companyId && employee.companyId !== run.companyId) return false;
    if (employee.status === "INACTIVE") return false;
    const monthStart = new Date(run.calendarYear, run.calendarMonth - 1, 1);
    const monthEnd = new Date(run.calendarYear, run.calendarMonth, 0);
    if (new Date(employee.dateOfJoining) > monthEnd) return false;
    if (employee.dateOfLeaving && new Date(employee.dateOfLeaving) < monthStart) return false;
    if (run.payrollGroup && employee.payrollGroup !== run.payrollGroup) return false;
    return true;
  }

  /** Computes one employee's line (honoring any saved run.overrides for them) and upserts it into run.lines. Shared by processPayrollRun (bulk) and recalculateLine (single row, e.g. after editing LOP/bonus overrides). */
  function computeAndUpsertLine(db, run, employee) {
    const override = (run.overrides && run.overrides[employee.id]) || {};
    const result = computeEmployeePayrollLine(db, run.id, employee.id, {
      lopDays: override.lopDays,
      variablePay: override.variablePay,
      deductionAdjustments: override.deductionAdjustments,
      employerContribAdjustments: override.employerContribAdjustments,
      tdsOverride: override.tdsOverride,
      pfArrears: override.pfArrears,
      skipLoanRecovery: override.skipLoanRecovery,
    });
    const existingIdx = run.lines.findIndex((l) => l.employeeId === employee.id);
    const adjustments = existingIdx >= 0 ? run.lines[existingIdx].adjustments : [];
    // Manual Adjustments (addAdjustment) are applied on top of net pay as
    // their own separate mechanism, outside this function's own
    // computeEmployeePayrollLine call - so a fresh netSalary computed here
    // (e.g. from clicking Recalculate, or saving a different manual
    // override) must re-add them, or they'd silently vanish from net pay
    // while still showing in the Adjustments total and list (the bug
    // reported: Adjustments shown but not reflected in Net Pay).
    const adjustmentsTotal = adjustments.reduce((s, a) => s + a.amount, 0);
    const line = {
      id: existingIdx >= 0 ? run.lines[existingIdx].id : newId("prl"),
      employeeId: employee.id,
      daysInMonth: result.daysInMonth,
      daysWorked: result.daysWorked,
      lopDays: result.lopDays,
      earnings: result.earnings,
      grossSalary: result.grossSalary,
      employerContributions: result.employerContributions,
      totalEmployerCost: result.totalEmployerCost,
      deductions: result.deductions,
      tdsMonthly: result.tdsMonthly,
      computedTdsMonthly: result.computedTdsMonthly,
      tdsMethodUsed: result.tdsMethodUsed,
      tdsOverridden: result.tdsOverridden,
      tdsOverrideReason: result.tdsOverridden ? override.tdsOverrideReason || "" : null,
      totalDeductions: result.totalDeductions,
      netSalary: result.netSalary + adjustmentsTotal,
      regimeUsed: result.regimeUsed,
      taxCalcSnapshot: result.taxCalcSnapshot,
      metrics: result.metrics,
      loanRecoveries: result.loanRecoveries,
      adjustments,
    };
    if (existingIdx >= 0) run.lines[existingIdx] = line;
    else run.lines.push(line);
    return line;
  }

  function processPayrollRun(db, runId) {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    if (run.status === "LOCKED" || run.status === "PAID") {
      throw new Error(`Payroll run is ${run.status.toLowerCase()} and cannot be recalculated. Use an adjustment instead.`);
    }
    const employees = db.employees.filter((e) => e.status !== "INACTIVE");
    const skipped = [];
    let processed = 0;

    for (const employee of employees) {
      if (!isEmployeeEligibleForRun(employee, run)) continue;
      try {
        computeAndUpsertLine(db, run, employee);
        processed++;
      } catch (err) {
        skipped.push({ employeeCode: employee.employeeCode, reason: err.message || String(err) });
      }
    }

    run.status = "CALCULATED";
    run.processedAt = new Date().toISOString();
    return { processed, skipped };
  }

  /** Recalculates a single employee's line within an already-calculated run - e.g. after editing their LOP days / one-time bonus overrides. Throws the same way computeEmployeePayrollLine would if something's wrong (e.g. no active salary structure). */
  function recalculateLine(db, runId, employeeId) {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    if (run.status === "LOCKED" || run.status === "PAID") {
      throw new Error(`Payroll run is ${run.status.toLowerCase()} and cannot be recalculated. Use an adjustment instead.`);
    }
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error("Employee not found");
    return computeAndUpsertLine(db, run, employee);
  }

  const TIMESTAMP_FIELD = { REVIEWED: "reviewedAt", APPROVED: "approvedAt", LOCKED: "lockedAt", PAID: "paidAt" };

  function advancePayrollStatus(db, runId, targetStatus) {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    const currentIndex = PAYROLL_STATUS_ORDER.indexOf(run.status);
    const targetIndex = PAYROLL_STATUS_ORDER.indexOf(targetStatus);
    if (targetIndex !== currentIndex + 1) {
      throw new Error(`Cannot move payroll run from ${run.status.toLowerCase()} to ${targetStatus.toLowerCase()}. Status must advance one step at a time: ${PAYROLL_STATUS_ORDER.map((s) => s.toLowerCase()).join(" -> ")}.`);
    }
    run.status = targetStatus;
    const field = TIMESTAMP_FIELD[targetStatus];
    if (field) run[field] = new Date().toISOString();
    return run;
  }

  /**
   * Undoes one review/approval step - e.g. after marking a run Reviewed,
   * noticing an error, and wanting to take another look before approving.
   * Only REVIEWED and APPROVED can be reverted this way (back to Calculated
   * or Reviewed respectively); once a run is Locked or Paid, this error is
   * meant to be fixed with a tracked adjustment instead, not an un-review -
   * same reasoning as processPayrollRun's own Locked/Paid guard.
   */
  function revertPayrollStatus(db, runId) {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    if (run.status !== "REVIEWED" && run.status !== "APPROVED") {
      throw new Error(`A ${run.status.toLowerCase()} payroll run cannot be reverted this way${run.status === "LOCKED" || run.status === "PAID" ? " - use an adjustment instead to correct it" : ""}.`);
    }
    const currentIndex = PAYROLL_STATUS_ORDER.indexOf(run.status);
    const clearedField = TIMESTAMP_FIELD[run.status];
    run.status = PAYROLL_STATUS_ORDER[currentIndex - 1];
    if (clearedField) run[clearedField] = null;
    return run;
  }

  function addAdjustment(db, payrollRunLineId, input) {
    if (!input.reason || !input.reason.trim()) throw new Error("A reason is required for every manual adjustment.");
    if (!input.enteredBy || !input.enteredBy.trim()) throw new Error("Adjustments must record who entered them.");
    for (const run of db.payrollRuns) {
      const line = run.lines.find((l) => l.id === payrollRunLineId);
      if (line) {
        const adjustment = { id: newId("adj"), amount: input.amount, reason: input.reason, enteredBy: input.enteredBy, createdAt: new Date().toISOString() };
        line.adjustments.push(adjustment);
        line.netSalary += input.amount;
        return adjustment;
      }
    }
    throw new Error("Payroll line not found");
  }

  /**
   * Finds months where this employee was already paid under an OLDER salary
   * structure than the one now active - i.e. arrears owed because a
   * revision was saved with an `effectiveFrom` backdated to before some
   * already-processed month(s) (`sinceDateIso`, normally the new
   * structure's effectiveFrom). Only LOCKED/PAID runs are included: a run
   * that's still open will simply pick up the new structure next time it's
   * (re)calculated, no arrears needed - those are returned separately as
   * `reprocessableRunIds` so the UI can point the admin at that simpler fix
   * instead. A line already flagged `arrearsSettled` (by a prior
   * applyArrears call for this same gap) is skipped, so calling this again
   * after applying doesn't re-offer or double-count the same months.
   *
   * Only compares EARNINGS (what the hypothetical hind-recalculation of
   * each affected month, under the now-active structure, would have paid
   * vs. what the stored line actually paid) - deductions/TDS for those
   * closed months are left exactly as they were; the arrears lump sum is
   * taxed fresh as ordinary income in whichever current/future run it's
   * applied to, via the normal ARREARS override path.
   */
  function computeArrears(db, employeeId, financialYearId, sinceDateIso) {
    const since = new Date(sinceDateIso);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const runs = db.payrollRuns.filter((r) => r.financialYearId === financialYearId).sort((a, b) => a.payrollMonthIndex - b.payrollMonthIndex);

    const months = [];
    const reprocessableRunIds = [];
    let total = 0;

    for (const run of runs) {
      const actualLine = run.lines.find((l) => l.employeeId === employeeId);
      if (!actualLine) continue; // not processed for this employee - nothing to compare against yet
      const runMonthDate = new Date(run.calendarYear, run.calendarMonth - 1, 1);
      if (runMonthDate < since || runMonthDate >= thisMonthStart) continue;
      if (actualLine.arrearsSettled) continue;

      const override = (run.overrides && run.overrides[employeeId]) || {};
      let hypothetical;
      try {
        hypothetical = computeEmployeePayrollLine(db, run.id, employeeId, { lopDays: override.lopDays, variablePay: override.variablePay, employerContribAdjustments: override.employerContribAdjustments });
      } catch {
        continue; // e.g. no active structure resolves for that date - skip rather than fail the whole calculation
      }
      const diff = hypothetical.grossSalary - actualLine.grossSalary;
      if (!diff) continue; // this month's stored line already matches the now-active structure - nothing outstanding

      if (run.status !== "LOCKED" && run.status !== "PAID") {
        reprocessableRunIds.push(run.id);
        continue;
      }

      const perComponent = {};
      for (const code of new Set([...Object.keys(hypothetical.earnings), ...Object.keys(actualLine.earnings)])) {
        const d = (hypothetical.earnings[code] || 0) - (actualLine.earnings[code] || 0);
        if (d) perComponent[code] = d;
      }
      // PF on arrears is due month by month: the difference between PF that
      // month would have carried under the revised structure (with that
      // month's own cap/ceiling) and PF actually paid.
      const pfDiff = Math.max(0, (hypothetical.employerContributions["EMPLOYER_PF"] || 0) - (actualLine.employerContributions["EMPLOYER_PF"] || 0));
      months.push({
        runId: run.id,
        payrollMonthIndex: run.payrollMonthIndex,
        calendarYear: run.calendarYear,
        calendarMonth: run.calendarMonth,
        previousGross: actualLine.grossSalary,
        revisedGross: hypothetical.grossSalary,
        diff,
        perComponent,
        pfDiff,
      });
      total += diff;
    }
    const pfTotal = months.reduce((s, m) => s + m.pfDiff, 0);

    const perComponentTotal = {};
    for (const m of months) {
      for (const [code, amt] of Object.entries(m.perComponent)) {
        perComponentTotal[code] = (perComponentTotal[code] || 0) + amt;
      }
    }

    return { months, total, perComponentTotal, reprocessableRunIds, pfTotal };
  }

  /** PF to add when applying arrears - the computed month-wise PF difference, scaled down if the admin applies only part of the Basic+DA arrears. */
  function pfOnAppliedArrears(arrears, amounts) {
    const pfTotal = arrears.pfTotal || 0;
    if (!pfTotal) return 0;
    const computedBasicDa = sumCodes(arrears.perComponentTotal, BASIC_DA_CODES);
    if (!(computedBasicDa > 0)) return pfTotal;
    const appliedBasicDa = sumCodes(amounts, BASIC_DA_CODES);
    return Math.round(pfTotal * Math.max(0, Math.min(1, appliedBasicDa / computedBasicDa)));
  }

  // Suffix marking an earning code as an arrears top-up of that same
  // component, rather than a change to the component's regular monthly
  // amount - keeps it a distinct, separately-labeled line on the payslip
  // (see componentDisplayLabel in payroll-runs.js) instead of silently
  // merging into (and so masking) this month's own BASIC/HRA/etc. figure.
  const ARREARS_CODE_SUFFIX = "__ARREARS";

  /**
   * Commits an arrears calculation (from computeArrears) into a still-open
   * run, one line item per salary component (Basic, HRA, etc.) rather than
   * a single lump sum, so the employee's payslip shows exactly which
   * component(s) the arrears relate to. `componentAmounts` lets the admin
   * apply an edited breakdown (e.g. rounding, or a deliberate partial
   * payment) instead of the auto-computed `arrears.perComponentTotal` -
   * passing it through unedited reproduces the previous lump-sum behavior,
   * just split by component. Recalculates the line and flags every source
   * month's line as settled so a later computeArrears call for the same
   * gap doesn't re-offer or double-count it.
   */
  function applyArrears(db, employeeId, targetRunId, arrears, componentAmounts) {
    const targetRun = db.payrollRuns.find((r) => r.id === targetRunId);
    if (!targetRun) throw new Error("Target payroll run not found");
    if (targetRun.status === "LOCKED" || targetRun.status === "PAID") {
      throw new Error(`That run is ${targetRun.status.toLowerCase()} - choose a run that's still open to receive the arrears.`);
    }
    if (!arrears || !arrears.months.length) throw new Error("Nothing to apply.");
    const amounts = componentAmounts || arrears.perComponentTotal;
    if (!amounts || Object.values(amounts).every((v) => !v)) throw new Error("Nothing to apply.");

    if (!targetRun.overrides) targetRun.overrides = {};
    const existing = targetRun.overrides[employeeId] || {};
    const variablePay = { ...(existing.variablePay || {}) };
    for (const [code, amt] of Object.entries(amounts)) {
      if (!amt) continue;
      const arrearsCode = `${code}${ARREARS_CODE_SUFFIX}`;
      variablePay[arrearsCode] = (variablePay[arrearsCode] || 0) + amt;
    }
    // Employer PF arrears ride in as an employer-contribution adjustment;
    // the employee's matching share follows automatically (Employee PF
    // mirrors Employer PF in computeEmployeePayrollLine).
    const pfArrears = pfOnAppliedArrears(arrears, amounts);
    const employerContribAdjustments = { ...(existing.employerContribAdjustments || {}) };
    if (pfArrears) employerContribAdjustments.EMPLOYER_PF = (employerContribAdjustments.EMPLOYER_PF || 0) + pfArrears;
    targetRun.overrides[employeeId] = { ...existing, lopDays: existing.lopDays, variablePay, employerContribAdjustments, pfArrears: (existing.pfArrears || 0) + pfArrears };

    const settledAt = new Date().toISOString();
    for (const m of arrears.months) {
      const sourceRun = db.payrollRuns.find((r) => r.id === m.runId);
      const line = sourceRun && sourceRun.lines.find((l) => l.employeeId === employeeId);
      if (line) line.arrearsSettled = { amount: m.diff, settledInRunId: targetRunId, settledAt };
    }

    return recalculateLine(db, targetRunId, employeeId);
  }

  /** Completed years of service for gratuity, per Sec 4(2) of the Payment of Gratuity Act: a part-year of 6 months or more rounds up to a full year, less than 6 months rounds down. */
  function computeServiceYears(dateOfJoiningIso, dateOfLeavingIso) {
    const start = new Date(dateOfJoiningIso);
    const end = new Date(dateOfLeavingIso);
    let totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (end.getDate() < start.getDate()) totalMonths -= 1;
    totalMonths = Math.max(0, totalMonths);
    const completedYears = Math.floor(totalMonths / 12);
    const extraMonths = totalMonths % 12;
    // Payment of Gratuity Act, 1972, Sec 4(2) proviso: a year's gratuity is
    // payable for "the completed year of service or part thereof in excess
    // of six months" - IN EXCESS OF six months, not six months exactly, so
    // an employee at precisely 6 years 6 months 0 days gets 6, not 7.
    // extraMonths alone can't tell "exactly 6 months" from "6 months and a
    // few days" (totalMonths above is whole-month-truncated), so the actual
    // comparison is done at day precision against the exact 6-month mark
    // measured from the last full-year service anniversary.
    const lastAnniversary = new Date(start.getFullYear() + completedYears, start.getMonth(), start.getDate());
    const sixMonthMark = new Date(lastAnniversary.getFullYear(), lastAnniversary.getMonth() + 6, lastAnniversary.getDate());
    const roundedYears = end > sixMonthMark ? completedYears + 1 : completedYears;
    return { completedYears, extraMonths, roundedYears, totalMonths };
  }

  /**
   * Average Basic+DA actually paid over the up-to-10 processed payroll
   * months immediately preceding (strictly before) the given month, for an
   * employee - the base figure Sec 19 (old Sec 10(10AA)) uses for leave
   * encashment exemption ("10 months' average salary immediately preceding
   * retirement/resignation"). Falls back to fewer months (flagged via
   * `monthsUsed`) if fewer than 10 processed months exist.
   */
  function computeAverageBasicDaLast10Months(db, employeeId, asOfDateIso) {
    // asOfDateIso is a plain "YYYY-MM-DD" string, parsed as UTC midnight -
    // reading it back with local getters (getFullYear/getMonth) rolls back
    // to the previous calendar day in any negative-UTC-offset timezone,
    // which can make `cutoff` a full month early. Read the calendar
    // year/month with the UTC getters instead, matching the same fix
    // already applied to the joining-month check above.
    const asOf = new Date(asOfDateIso);
    const cutoff = new Date(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1);
    const monthly = [];
    for (const run of db.payrollRuns) {
      const line = run.lines.find((l) => l.employeeId === employeeId);
      if (!line) continue;
      const runDate = new Date(run.calendarYear, run.calendarMonth - 1, 1);
      if (runDate >= cutoff) continue;
      monthly.push({ runDate, amount: sumCodes(line.earnings, LEAVE_ENCASHMENT_SALARY_CODES) });
    }
    monthly.sort((a, b) => b.runDate - a.runDate);
    const last10 = monthly.slice(0, 10);
    if (last10.length === 0) return { average: 0, monthsUsed: 0 };
    return { average: last10.reduce((s, m) => s + m.amount, 0) / last10.length, monthsUsed: last10.length };
  }

  /**
   * Gratuity exemption under Sec 19 (old Sec 10(10)). For an employee
   * covered by the Payment of Gratuity Act, 1972 (the default assumption
   * here - most shops/establishments/factories with 10+ employees):
   * exemption = LEAST of actual gratuity received, the statutory formula
   * (15 days' Basic+DA x completed/rounded years of service), and the
   * statutory ceiling (an editable Tax Rule Set field, Rs 20 lakh by
   * default). Government employees are fully exempt with no ceiling.
   */
  function computeGratuityExemption(db, params) {
    const { employee, actualGratuity, basicPlusDaMonthly, serviceYears, financialYearCode, asOfDateIso } = params;
    if (employee.isGovernmentEmployee) {
      return { actual: actualGratuity, exempt: actualGratuity, taxable: 0, statutoryFormula: actualGratuity, cap: null, basis: "Government employee: fully exempt, no ceiling (Sec 19 / old Sec 10(10))." };
    }
    const config = getTaxRuleSetConfig(db, financialYearCode, employee.taxRegime || "OLD", asOfDateIso);
    const cap = config.deductionLimits.GRATUITY_EXEMPTION;
    const statutoryFormula = Math.round(((basicPlusDaMonthly * 15) / 26) * serviceYears);
    const exempt = Math.max(0, Math.min(actualGratuity, statutoryFormula, cap));
    const taxable = Math.max(0, actualGratuity - exempt);
    return {
      actual: actualGratuity,
      exempt,
      taxable,
      statutoryFormula,
      cap,
      basis: `Least of actual (${actualGratuity}), 15/26 x Basic+DA x ${serviceYears} year(s) of service (${statutoryFormula}), and the Rs ${cap.toLocaleString("en-IN")} statutory ceiling (Sec 19 / old Sec 10(10)).`,
    };
  }

  /**
   * Leave encashment exemption under Sec 19 (old Sec 10(10AA)), for a
   * non-government employee on resignation/retirement: exemption = LEAST of
   * actual amount received, 10 months' average Basic+DA, the cash
   * equivalent of earned leave (max 30 days per completed year of service),
   * and the REMAINING statutory ceiling (an editable Tax Rule Set field, Rs
   * 25 lakh by default - a LIFETIME AGGREGATE across all employers) after
   * subtracting `previouslyReceivedElsewhere` (a manually entered, one-time
   * figure on the Employee record for leave encashment already received
   * from a prior employer in this same career - this app only processes
   * payroll for the current employer, so it cannot look that up itself).
   * Government employees are fully exempt with no ceiling.
   */
  function computeLeaveEncashmentExemption(db, params) {
    const { employee, actualLeaveEncashment, leaveDaysEncashed, perDayRate, financialYearCode, asOfDateIso, previouslyReceivedElsewhere } = params;
    if (employee.isGovernmentEmployee) {
      return { actual: actualLeaveEncashment, exempt: actualLeaveEncashment, taxable: 0, cap: null, basis: "Government employee: fully exempt, no ceiling (Sec 19 / old Sec 10(10AA))." };
    }
    const config = getTaxRuleSetConfig(db, financialYearCode, employee.taxRegime || "OLD", asOfDateIso);
    const cap = config.deductionLimits.LEAVE_ENCASHMENT_EXEMPTION;
    const priorUsed = previouslyReceivedElsewhere || 0;
    const remainingCap = Math.max(0, cap - priorUsed);
    const service = computeServiceYears(employee.dateOfJoining, employee.dateOfLeaving);
    const { average: avgBasicDa, monthsUsed } = computeAverageBasicDaLast10Months(db, employee.id, asOfDateIso);
    const tenMonthAverage = Math.round(avgBasicDa * 10);
    const maxEncashableDays = Math.min(leaveDaysEncashed, service.completedYears * 30);
    const cashEquivalentOfEarnedLeave = Math.round(maxEncashableDays * perDayRate);
    const exempt = Math.max(0, Math.min(actualLeaveEncashment, tenMonthAverage, cashEquivalentOfEarnedLeave, remainingCap));
    const taxable = Math.max(0, actualLeaveEncashment - exempt);
    return {
      actual: actualLeaveEncashment,
      exempt,
      taxable,
      tenMonthAverage,
      monthsUsedForAverage: monthsUsed,
      cashEquivalentOfEarnedLeave,
      cap,
      priorUsed,
      remainingCap,
      basis: `Least of actual (${actualLeaveEncashment}), 10 months' average Basic+DA (${tenMonthAverage}, from ${monthsUsed} processed month(s) of data), cash equivalent of earned leave capped at 30 days/completed year (${cashEquivalentOfEarnedLeave}), and the remaining lifetime statutory ceiling (Rs ${cap.toLocaleString("en-IN")} minus Rs ${priorUsed.toLocaleString("en-IN")} already received from a previous employer = Rs ${remainingCap.toLocaleString("en-IN")}) (Sec 19 / old Sec 10(10AA)).`,
    };
  }

  /**
   * Posts a Full & Final Settlement to the given (still-open) payroll run
   * line: gratuity and leave encashment are split into their statutorily
   * EXEMPT portion (posted as a tax-free Manual Adjustment to net pay, same
   * as before) and any TAXABLE EXCESS over the exemption (routed through
   * the run's variablePay override - GRATUITY_TAXABLE / LEAVE_ENCASHMENT_TAXABLE -
   * so it is correctly taxed, same mechanism as Bonus/Arrears). Notice pay
   * recovery is unaffected - a plain net-pay deduction either way.
   */
  function applyFnfSettlement(db, employeeId, targetRunId, input) {
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error("Employee not found");
    const targetRun = db.payrollRuns.find((r) => r.id === targetRunId);
    if (!targetRun) throw new Error("Target payroll run not found");
    if (targetRun.status === "LOCKED" || targetRun.status === "PAID") {
      throw new Error(`That run is ${targetRun.status.toLowerCase()} - choose a run that's still open to receive the F&F settlement.`);
    }
    const fy = db.financialYears.find((f) => f.id === targetRun.financialYearId);
    const asOfDateIso = employee.dateOfLeaving || new Date().toISOString();

    const result = { gratuity: null, leaveEncashment: null };
    let taxableAdded = 0;

    if (!targetRun.overrides) targetRun.overrides = {};
    const existing = targetRun.overrides[employeeId] || {};
    const variablePay = { ...(existing.variablePay || {}) };

    if (input.gratuity) {
      const ex = computeGratuityExemption(db, {
        employee,
        actualGratuity: input.gratuity,
        basicPlusDaMonthly: input.basicPlusDaMonthly,
        serviceYears: input.serviceYears,
        financialYearCode: fy.code,
        asOfDateIso,
      });
      result.gratuity = ex;
      if (ex.taxable) {
        variablePay.GRATUITY_TAXABLE = (variablePay.GRATUITY_TAXABLE || 0) + ex.taxable;
        taxableAdded += ex.taxable;
      }
    }
    if (input.leaveEncashment) {
      const ex = computeLeaveEncashmentExemption(db, {
        employee,
        actualLeaveEncashment: input.leaveEncashment,
        leaveDaysEncashed: input.leaveDays,
        perDayRate: input.leaveRate,
        financialYearCode: fy.code,
        asOfDateIso,
        previouslyReceivedElsewhere: employee.previousLeaveEncashmentReceived || 0,
      });
      result.leaveEncashment = ex;
      if (ex.taxable) {
        variablePay.LEAVE_ENCASHMENT_TAXABLE = (variablePay.LEAVE_ENCASHMENT_TAXABLE || 0) + ex.taxable;
        taxableAdded += ex.taxable;
      }
    }

    if (taxableAdded > 0) {
      targetRun.overrides[employeeId] = { ...existing, variablePay };
      recalculateLine(db, targetRunId, employeeId);
    }

    const line = targetRun.lines.find((l) => l.employeeId === employeeId);
    if (!line) throw new Error("That run hasn't been calculated for this employee yet. Open it and click \"Run Calculation\" first.");

    if (result.gratuity && result.gratuity.exempt) {
      addAdjustment(db, line.id, { amount: result.gratuity.exempt, reason: `Gratuity - exempt portion (${result.gratuity.basis})`, enteredBy: "F&F Settlement" });
    }
    if (result.leaveEncashment && result.leaveEncashment.exempt) {
      addAdjustment(db, line.id, { amount: result.leaveEncashment.exempt, reason: `Leave Encashment - exempt portion (${result.leaveEncashment.basis})`, enteredBy: "F&F Settlement" });
    }
    if (input.noticeRecovery) {
      addAdjustment(db, line.id, { amount: -input.noticeRecovery, reason: "Notice Pay Recovery", enteredBy: "F&F Settlement" });
    }

    return result;
  }

  /**
   * Previews the effect of switching an employee's TDS regime from the next
   * payroll run onward: the law lets an employee revise the regime they've
   * intimated to their employer for TDS purposes during the year (it isn't
   * locked at joining), and switching doesn't need any special "split the
   * year in two" math - computeEmployeePayrollLine already always computes
   * BOTH regimes' monthlyTds off the same actual YTD income/TDS-withheld
   * figures and projects the remainder of the year, so whichever regime
   * ends up "current" from that point on gets a correctly trued-up monthly
   * TDS automatically. This just surfaces both monthly figures, computed
   * against the next still-open run, so the admin can see the impact
   * before committing - without guessing at a from-scratch annual estimate.
   * Returns `{ hasUpcomingRun: false }` if there's no open run left to
   * preview against (the caller can fall back to the full-year
   * estimateRegimeComparison figures already shown elsewhere instead).
   */
  function previewRegimeSwitch(db, employeeId, financialYearId) {
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) return { hasUpcomingRun: false };
    const nextRun = db.payrollRuns
      .filter(
        (r) =>
          r.financialYearId === financialYearId &&
          r.companyId === employee.companyId &&
          r.status !== "LOCKED" &&
          r.status !== "PAID" &&
          !r.lines.some((l) => l.employeeId === employeeId) && // not yet processed for this employee - a preview of what's coming, not a retroactive recompute of an already-processed month
          isEmployeeEligibleForRun(employee, r),
      )
      .sort((a, b) => a.payrollMonthIndex - b.payrollMonthIndex)[0];
    if (!nextRun) return { hasUpcomingRun: false };

    const override = (nextRun.overrides && nextRun.overrides[employeeId]) || {};
    let result;
    try {
      result = computeEmployeePayrollLine(db, nextRun.id, employeeId, { lopDays: override.lopDays, variablePay: override.variablePay });
    } catch {
      return { hasUpcomingRun: false };
    }
    return {
      hasUpcomingRun: true,
      runId: nextRun.id,
      payrollMonthIndex: nextRun.payrollMonthIndex,
      calendarYear: nextRun.calendarYear,
      calendarMonth: nextRun.calendarMonth,
      currentRegime: employee.taxRegime,
      oldMonthlyTds: result.taxCalcSnapshot.old.monthlyTds,
      newMonthlyTds: result.taxCalcSnapshot.new.monthlyTds,
    };
  }

  /** Switches an employee's TDS regime going forward and records the change in employee.regimeSwitchHistory (separate from the general audit log, so it stays with the employee's own record for Form 16 / compliance purposes). Past months' already-withheld TDS is never touched - only future runs are affected. */
  function applyRegimeSwitch(db, employeeId, newRegime) {
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error("Employee not found");
    if (newRegime !== "OLD" && newRegime !== "NEW") throw new Error("Regime must be OLD or NEW.");
    if (employee.taxRegime === newRegime) throw new Error(`Employee is already on the ${newRegime} regime.`);
    if (!employee.regimeSwitchHistory) employee.regimeSwitchHistory = [];
    employee.regimeSwitchHistory.push({ from: employee.taxRegime, to: newRegime, changedAt: new Date().toISOString() });
    employee.taxRegime = newRegime;
    return employee;
  }

  /**
   * Flags when the regime NOT currently set on the employee would save
   * them more than `minSavings` in full-year tax liability (via
   * estimateRegimeComparison) - a nudge only. Nothing here ever changes
   * employee.taxRegime or what TDS actually gets withheld; a human still
   * has to act on it via applyRegimeSwitch (or the "Switch regime" button
   * on the employee's Regime Comparison tab). Returns null when there's
   * nothing to flag (no active salary structure yet, already on the
   * cheaper regime, or the difference is below the threshold - a small
   * default of Rs 500 avoids noise from trivial rounding/surcharge-edge
   * differences that aren't worth a switch).
   */
  function regimeSuggestion(db, employeeId, financialYearId, minSavings) {
    const employee = db.employees.find((e) => e.id === employeeId);
    if (!employee) return null;
    const estimate = estimateRegimeComparison(db, employeeId, financialYearId);
    if (!estimate) return null;
    const threshold = minSavings ?? 500;
    const onOld = employee.taxRegime === "OLD";
    const currentLiability = onOld ? estimate.old.totalTaxLiability : estimate.new.totalTaxLiability;
    const otherLiability = onOld ? estimate.new.totalTaxLiability : estimate.old.totalTaxLiability;
    const savings = currentLiability - otherLiability;
    if (savings <= threshold) return null;
    return { currentRegime: employee.taxRegime, beneficialRegime: onOld ? "NEW" : "OLD", currentLiability, beneficialLiability: otherLiability, savings };
  }

  /**
   * Projects a full-year Old vs New regime comparison directly from the
   * active Salary Structure + Investment Declaration + Previous Employer
   * records for a FY - independent of any payroll run ever having been
   * processed.
   */
  function estimateRegimeComparison(db, employeeId, financialYearId) {
    const employee = db.employees.find((e) => e.id === employeeId);
    const fy = db.financialYears.find((f) => f.id === financialYearId);
    if (!employee || !fy) return null;

    const asOf = fy.endDate;
    const candidates = db.employeeSalaryStructures.filter((s) => s.employeeId === employeeId && s.financialYearId === financialYearId && s.isActive);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
    const structure = candidates[0];

    const declaration = db.investmentDeclarations.find((d) => d.employeeId === employeeId && d.financialYearId === financialYearId) || null;
    const prevEmployerRows = db.previousEmployerIncomes.filter((p) => p.employeeId === employeeId && p.financialYearId === financialYearId);
    const perquisitesForEstimate = annualPerquisites(db, employee, fy);
    const perquisitesAnnualForEstimate = perquisitesForEstimate.total;

    const earningsAnnual = {}, employerAnnual = {}, deductionAnnual = {};
    const company = companyOf(db, employee);
    for (const c of structure.components) {
      if (isComponentSuppressed(employee, c.componentCode, undefined, company)) continue;
      const map = c.category === "EARNING" ? earningsAnnual : c.category === "EMPLOYER_CONTRIBUTION" ? employerAnnual : deductionAnnual;
      map[c.componentCode] = (map[c.componentCode] ?? 0) + c.annualAmount;
    }

    const annualGross = Object.values(earningsAnnual).reduce((s, v) => s + v, 0);
    const basicPlusDaAnnual = sumCodes(earningsAnnual, BASIC_DA_CODES);
    const employerPfNpsSuperAnnual = sumCodes(employerAnnual, PERQ_CHECK_CODES);
    const employerNpsAnnual = employerAnnual["EMPLOYER_NPS"] ?? 0;
    // Employee PF always matches Employer PF (see computeEmployeePayrollLine).
    const employeePfAnnual = employerAnnual["EMPLOYER_PF"] ?? 0;

    const oldConfig = getTaxRuleSetConfig(db, fy.code, "OLD", asOf);
    const newConfig = getTaxRuleSetConfig(db, fy.code, "NEW", asOf);

    // Summed month-by-month (not monthlyRent x 12) since a declared rent
    // period can start or end partway through the year.
    const fyStartYearForEstimate = new Date(fy.startDate).getFullYear();
    // Auto-computed from state PT slabs (same as a real payroll run would),
    // not just whatever fixed PROFESSIONAL_TAX figure the structure has -
    // which is usually absent/stale since PT is normally auto-calculated,
    // not manually entered (see computeEmployeePayrollLine).
    const ptAnnual = estimateAnnualPt(db, employee, fyStartYearForEstimate, annualGross / 12, deductionAnnual["PROFESSIONAL_TAX"] ?? 0);
    let hraExemptionAnnual = 0;
    for (let m = 1; m <= 12; m++) {
      const { calendarYear: cy, calendarMonth: cm } = fyMonthIndexToCalendar(m, fyStartYearForEstimate);
      const rentActive = isRentActiveInMonth(cy, cm, declaration?.rentStartDate, declaration?.rentEndDate);
      hraExemptionAnnual += monthlyHraExemption(
        { basic: basicPlusDaAnnual / 12, hraReceived: (earningsAnnual["HRA"] ?? 0) / 12, rentPaid: rentActive ? declaration?.monthlyRent ?? 0 : 0, isMetro: declaration?.isMetroCity },
        oldConfig.hraConfig,
      );
    }

    const previousEmployerTaxableSalary = prevEmployerRows.reduce((s, r) => s + r.taxableSalary, 0);
    const tdsDeductedPreviousEmployer = prevEmployerRows.reduce((s, r) => s + r.tdsDeducted, 0);

    const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
    const section80C =
      (declaration?.lic ?? 0) + (declaration?.epf ?? 0) + (declaration?.ppf ?? 0) + (declaration?.elss ?? 0) +
      (declaration?.lifeInsurance ?? 0) + (declaration?.tuitionFees ?? 0) + (declaration?.housingLoanPrincipal ?? 0) +
      (declaration?.otherSection80C ?? 0) + (declaration?.section80CCC ?? 0) + (declaration?.section80CCD1 ?? 0) +
      employeePfAnnual;

    function buildInput(regime) {
      return {
        regime,
        ageCategory,
        grossSalaryCurrentEmployer: annualGross,
        perquisitesOther: perquisitesAnnualForEstimate,
        employerNpsContribution: employerNpsAnnual,
        employerPfNpsSuperContribution: employerPfNpsSuperAnnual,
        previousEmployerTaxableSalary,
        hraExemption: hraExemptionAnnual,
        childrenAllowanceExemption: 12 * monthlyChildrenAllowanceExemption(Object.fromEntries(Object.entries(earningsAnnual).map(([k, v]) => [k, v / 12])), declaration, oldConfig.deductionLimits),
        ltaExemption: declaration?.ltaClaimed ?? 0,
        professionalTaxPaid: ptAnnual,
        selfOccupiedHomeLoanInterest: declaration?.homeLoanInterestSelfOccupied ?? 0,
        letOutAnnualValue: declaration?.letOutAnnualValue ?? 0,
        letOutMunicipalTax: declaration?.letOutMunicipalTax ?? 0,
        letOutHomeLoanInterest: declaration?.letOutHomeLoanInterest ?? 0,
        otherIncomeDeclared: 0,
        deductions: {
          section80C,
          section80CCD1B: declaration?.section80CCD1B ?? 0,
          section80CCD2Employer: employerNpsAnnual,
          basicPlusDaAnnual,
          section80DSelfBelow60: declaration?.section80DSelfBelow60 ?? 0,
          section80DParentsBelow60: declaration?.section80DParentsBelow60 ?? 0,
          section80DSelfAbove60: declaration?.section80DSelfAbove60 ?? 0,
          section80DParentsAbove60: declaration?.section80DParentsAbove60 ?? 0,
          section80E: declaration?.section80E ?? 0,
          section80EE: declaration?.section80EE ?? 0,
          section80EEA: declaration?.section80EEA ?? 0,
          section80UBelow80: declaration?.section80UBelow80 ?? 0,
          section80U80AndAbove: declaration?.section80U80AndAbove ?? 0,
          section80DDBelow80: declaration?.section80DDBelow80 ?? 0,
          section80DD80AndAbove: declaration?.section80DD80AndAbove ?? 0,
          donations80G: declaration?.donations80G ?? 0,
          otherDeductions: declaration?.otherDeductions ?? 0,
        },
        tdsAlreadyDeductedCurrentEmployer: 0,
        tdsDeductedPreviousEmployer,
        remainingMonthsInFY: 12,
      };
    }

    const oldResult = calculateTax(buildInput("OLD"), oldConfig);
    const newResult = calculateTax(buildInput("NEW"), newConfig);

    if (!declaration) {
      oldResult.warnings.unshift(
        "No Investment Declaration is on file for this FY yet - the Old Regime figures below assume zero Chapter VI-A deductions/HRA rent, so they may look worse than reality. Fill in the Investment Declaration for an accurate comparison.",
      );
    }

    return {
      old: oldResult,
      new: newResult,
      annualGross,
      hasDeclaration: !!declaration,
      earningsAnnual,
      perquisiteBreakdown: perquisitesForEstimate.breakdown,
      declaration,
    };
  }

  /**
   * Year's tax computation from what was ACTUALLY paid in processed payroll
   * runs (salary incl. bonus/arrears/LOP/F&F, HRA exemption per month, PT
   * and employee PF actually deducted) and the TDS actually withheld - the
   * figures a salary TDS certificate (Form 130, formerly Form 16) Part B
   * must report. Returns null when no month has been processed yet.
   */
  function computeAnnualTaxFromActuals(db, employeeId, financialYearId) {
    const employee = db.employees.find((e) => e.id === employeeId);
    const fy = db.financialYears.find((f) => f.id === financialYearId);
    if (!employee || !fy) return null;
    const lines = db.payrollRuns
      .filter((r) => r.financialYearId === fy.id)
      .flatMap((r) => r.lines.filter((l) => l.employeeId === employeeId));
    if (lines.length === 0) return null;

    let annualGross = 0, basicPlusDaAnnual = 0, employerPfNpsSuperAnnual = 0, employerNpsAnnual = 0, ptAnnual = 0, hraExemptionAnnual = 0, tdsDeducted = 0, employeePfAnnual = 0, exemptTerminalBenefits = 0, childrenAllowanceExemptionAnnual = 0;
    const earningsAnnual = {};
    for (const l of lines) {
      annualGross += l.grossSalary;
      for (const [code, amt] of Object.entries(l.earnings)) earningsAnnual[code] = (earningsAnnual[code] || 0) + amt;
      basicPlusDaAnnual += sumCodes(l.earnings, BASIC_DA_CODES);
      employerPfNpsSuperAnnual += sumCodes(l.employerContributions, PERQ_CHECK_CODES);
      employerNpsAnnual += l.employerContributions["EMPLOYER_NPS"] ?? 0;
      ptAnnual += l.deductions["PROFESSIONAL_TAX"] ?? 0;
      employeePfAnnual += l.deductions["EMPLOYEE_PF"] ?? 0;
      hraExemptionAnnual += (l.metrics && l.metrics.hraExemptionThisMonth) || 0;
      childrenAllowanceExemptionAnnual += (l.metrics && l.metrics.childrenAllowanceExemptionThisMonth) || 0;
      tdsDeducted += l.tdsMonthly;
      exemptTerminalBenefits += (l.adjustments || []).filter((a) => a.enteredBy === "F&F Settlement" && a.amount > 0).reduce((s, a) => s + a.amount, 0);
    }

    const declaration = db.investmentDeclarations.find((d) => d.employeeId === employeeId && d.financialYearId === fy.id) || null;
    const prevEmployerRows = db.previousEmployerIncomes.filter((p) => p.employeeId === employeeId && p.financialYearId === fy.id);
    const perquisites = annualPerquisites(db, employee, fy);
    const oldConfig = getTaxRuleSetConfig(db, fy.code, "OLD", fy.endDate);
    const newConfig = getTaxRuleSetConfig(db, fy.code, "NEW", fy.endDate);
    const section80C =
      (declaration?.lic ?? 0) + (declaration?.epf ?? 0) + (declaration?.ppf ?? 0) + (declaration?.elss ?? 0) +
      (declaration?.lifeInsurance ?? 0) + (declaration?.tuitionFees ?? 0) + (declaration?.housingLoanPrincipal ?? 0) +
      (declaration?.otherSection80C ?? 0) + (declaration?.section80CCC ?? 0) + (declaration?.section80CCD1 ?? 0) +
      employeePfAnnual;

    const buildInput = (regime) => ({
      regime,
      ageCategory: deriveAgeCategory(employee.dob, fy.endDate),
      grossSalaryCurrentEmployer: annualGross,
      perquisitesOther: perquisites.total,
      employerNpsContribution: employerNpsAnnual,
      employerPfNpsSuperContribution: employerPfNpsSuperAnnual,
      previousEmployerTaxableSalary: prevEmployerRows.reduce((s, r) => s + r.taxableSalary, 0),
      hraExemption: hraExemptionAnnual,
      childrenAllowanceExemption: childrenAllowanceExemptionAnnual,
      ltaExemption: declaration?.ltaClaimed ?? 0,
      professionalTaxPaid: ptAnnual,
      selfOccupiedHomeLoanInterest: declaration?.homeLoanInterestSelfOccupied ?? 0,
      letOutAnnualValue: declaration?.letOutAnnualValue ?? 0,
      letOutMunicipalTax: declaration?.letOutMunicipalTax ?? 0,
      letOutHomeLoanInterest: declaration?.letOutHomeLoanInterest ?? 0,
      otherIncomeDeclared: 0,
      deductions: {
        section80C,
        section80CCD1B: declaration?.section80CCD1B ?? 0,
        section80CCD2Employer: employerNpsAnnual,
        basicPlusDaAnnual,
        section80DSelfBelow60: declaration?.section80DSelfBelow60 ?? 0,
        section80DParentsBelow60: declaration?.section80DParentsBelow60 ?? 0,
        section80DSelfAbove60: declaration?.section80DSelfAbove60 ?? 0,
        section80DParentsAbove60: declaration?.section80DParentsAbove60 ?? 0,
        section80E: declaration?.section80E ?? 0,
        section80EE: declaration?.section80EE ?? 0,
        section80EEA: declaration?.section80EEA ?? 0,
        section80UBelow80: declaration?.section80UBelow80 ?? 0,
        section80U80AndAbove: declaration?.section80U80AndAbove ?? 0,
        section80DDBelow80: declaration?.section80DDBelow80 ?? 0,
        section80DD80AndAbove: declaration?.section80DD80AndAbove ?? 0,
        donations80G: declaration?.donations80G ?? 0,
        otherDeductions: declaration?.otherDeductions ?? 0,
      },
      tdsAlreadyDeductedCurrentEmployer: tdsDeducted,
      tdsDeductedPreviousEmployer: prevEmployerRows.reduce((s, r) => s + r.tdsDeducted, 0),
      remainingMonthsInFY: 0,
    });

    return {
      old: calculateTax(buildInput("OLD"), oldConfig),
      new: calculateTax(buildInput("NEW"), newConfig),
      annualGross,
      earningsAnnual,
      monthsProcessed: lines.length,
      tdsDeducted,
      exemptTerminalBenefits,
      hasDeclaration: !!declaration,
    };
  }

  const PayrollEngine = {
    PAYROLL_STATUS_ORDER,
    computeAnnualTaxFromActuals,
    annualPerquisites,
    hasRecoverableLoans,
    getTaxRuleSetConfig,
    getWageCeilingConfig,
    getActiveStructure,
    generateStructureFromTemplate,
    expandSalaryTemplate,
    computeEmployeePayrollLine,
    isEmployeeEligibleForRun,
    processPayrollRun,
    recalculateLine,
    advancePayrollStatus,
    revertPayrollStatus,
    addAdjustment,
    computeArrears,
    applyArrears,
    ARREARS_CODE_SUFFIX,
    computeServiceYears,
    computeAverageBasicDaLast10Months,
    computeGratuityExemption,
    computeLeaveEncashmentExemption,
    applyFnfSettlement,
    previewRegimeSwitch,
    applyRegimeSwitch,
    estimateRegimeComparison,
    regimeSuggestion,
  };

  if (isNode) {
    module.exports = PayrollEngine;
  } else {
    root.PayrollEngine = PayrollEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
