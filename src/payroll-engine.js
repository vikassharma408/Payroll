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
  const { calendarToFyMonthIndex, daysInCalendarMonth, fyMonthIndexToCalendar } = isNode ? require("./dates.js") : { calendarToFyMonthIndex: root.calendarToFyMonthIndex, daysInCalendarMonth: root.daysInCalendarMonth, fyMonthIndexToCalendar: root.fyMonthIndexToCalendar };
  const { newId } = isNode ? require("./db.js") : { newId: root.newId };
  const { computePerquisitesTotal } = isNode ? require("./perquisites.js") : { computePerquisitesTotal: root.computePerquisitesTotal };
  const { computeMonthlyPT } = isNode ? require("./pt-slabs.js") : { computeMonthlyPT: root.computeMonthlyPT };

  const PERQ_CHECK_CODES = ["EMPLOYER_PF", "EMPLOYER_NPS", "EMPLOYER_SUPERANNUATION"];
  const BASIC_DA_CODES = ["BASIC", "DA"];
  const NOT_PRORATED_DEDUCTION_CODES = ["PROFESSIONAL_TAX", "LWF", "LOAN_RECOVERY", "SALARY_ADVANCE"];
  const PAYROLL_STATUS_ORDER = ["DRAFT", "CALCULATED", "REVIEWED", "APPROVED", "LOCKED", "PAID"];

  function sumCodes(map, codes) {
    return codes.reduce((s, code) => s + (map[code] ?? 0), 0);
  }

  /** Whether a declared rent period (start/end dates, either optional) covers any part of the given calendar month - so HRA exemption only applies for months rent was actually being paid. */
  function isRentActiveInMonth(calendarYear, calendarMonth, rentStartDate, rentEndDate) {
    const monthStart = new Date(calendarYear, calendarMonth - 1, 1);
    const monthEnd = new Date(calendarYear, calendarMonth, 0);
    if (rentStartDate && monthEnd < new Date(rentStartDate)) return false;
    if (rentEndDate && monthStart > new Date(rentEndDate)) return false;
    return true;
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

  function getActiveStructure(db, employeeId, financialYearId, asOfDateIso) {
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
    return {
      annualCTC: structure.annualCTC,
      components: structure.components.map((c) => ({ code: c.componentCode, category: c.category, monthlyAmount: c.monthlyAmount })),
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
    const currentMonthDate = new Date(run.calendarYear, run.calendarMonth - 1, 1);
    const currentMonthDateIso = currentMonthDate.toISOString();

    const structure = getActiveStructure(db, employeeId, fy.id, currentMonthDateIso);
    if (!structure) {
      throw new Error(`No active salary structure for employee ${employee.employeeCode} in FY ${fy.code}`);
    }

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

    const deductions = {};
    let totalDeductionsExclTds = 0;
    for (const c of structure.components.filter((c) => c.category === "DEDUCTION")) {
      const amt = NOT_PRORATED_DEDUCTION_CODES.includes(c.code) ? Math.round(c.monthlyAmount) : Math.round(c.monthlyAmount * prorationFactor);
      deductions[c.code] = amt;
      totalDeductionsExclTds += amt;
    }

    // If the employee has a state set (for state-wise Professional Tax) and
    // PT applies to them, auto-compute PT from this month's gross salary and
    // the (editable) db.ptSlabs for that state, overriding whatever the
    // salary structure's own fixed PT component said. Falls back to the
    // structure's figure for MANUAL/unrecognized states.
    if (employee.ptApplicable && employee.state) {
      const autoPt = computeMonthlyPT(db.ptSlabs, employee.state, grossSalary);
      if (autoPt !== null) {
        const roundedPt = Math.round(autoPt);
        totalDeductionsExclTds += roundedPt - (deductions["PROFESSIONAL_TAX"] || 0);
        deductions["PROFESSIONAL_TAX"] = roundedPt;
      }
    }

    const basicPlusDaThisMonth = sumCodes(earnings, BASIC_DA_CODES);
    const employerPfNpsSuperThisMonth = sumCodes(employerContributions, PERQ_CHECK_CODES);
    const employerNpsThisMonth = employerContributions["EMPLOYER_NPS"] ?? 0;
    const ptThisMonth = deductions["PROFESSIONAL_TAX"] ?? 0;

    const declaration = db.investmentDeclarations.find((d) => d.employeeId === employeeId && d.financialYearId === fy.id) || null;
    const prevEmployer = db.previousEmployerIncomes.find((p) => p.employeeId === employeeId && p.financialYearId === fy.id) || null;
    const perquisiteEntries = db.employeePerquisites.filter((p) => p.employeeId === employeeId && p.financialYearId === fy.id);
    const perquisitesAnnual = computePerquisitesTotal(perquisiteEntries, fy.startDate).total;

    const oldConfig = getTaxRuleSetConfig(db, fy.code, "OLD", currentMonthDateIso);
    const newConfig = getTaxRuleSetConfig(db, fy.code, "NEW", currentMonthDateIso);

    const rentActiveThisMonth = isRentActiveInMonth(run.calendarYear, run.calendarMonth, declaration?.rentStartDate, declaration?.rentEndDate);
    const rentPaidThisMonth = rentActiveThisMonth ? (declaration?.monthlyRent ?? 0) * prorationFactor : 0;
    const hraExemptionThisMonth = monthlyHraExemption(
      { basic: basicPlusDaThisMonth, hraReceived: earnings["HRA"] ?? 0, rentPaid: rentPaidThisMonth, isMetro: employee.isMetroCity },
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
    let ytdGross = 0, ytdBasicPlusDa = 0, ytdEmployerPfNpsSuper = 0, ytdEmployerNps = 0, ytdPt = 0, ytdHraExemption = 0, ytdTds = 0;
    for (const line of priorLines) {
      ytdGross += line.grossSalary;
      ytdBasicPlusDa += sumCodes(line.earnings, BASIC_DA_CODES);
      ytdEmployerPfNpsSuper += sumCodes(line.employerContributions, PERQ_CHECK_CODES);
      ytdEmployerNps += line.employerContributions["EMPLOYER_NPS"] ?? 0;
      ytdPt += line.deductions["PROFESSIONAL_TAX"] ?? 0;
      ytdHraExemption += line.metrics.hraExemptionThisMonth ?? 0;
      ytdTds += line.tdsMonthly;
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
        { basic: projBasicPlusDaPerMonth, hraReceived: structureEarningMap["HRA"] ?? 0, rentPaid: rentActive ? declaration?.monthlyRent ?? 0 : 0, isMetro: employee.isMetroCity },
        oldConfig.hraConfig,
      );
    }

    const annualGross = ytdGross + grossSalary + remainingProjectionMonths * projGrossPerMonth;
    const annualBasicPlusDa = ytdBasicPlusDa + basicPlusDaThisMonth + remainingProjectionMonths * projBasicPlusDaPerMonth;
    const annualEmployerPfNpsSuper = ytdEmployerPfNpsSuper + employerPfNpsSuperThisMonth + remainingProjectionMonths * projEmployerPfNpsSuperPerMonth;
    const annualEmployerNps = ytdEmployerNps + employerNpsThisMonth + remainingProjectionMonths * projEmployerNpsPerMonth;
    const annualPt = ytdPt + ptThisMonth + remainingProjectionMonths * projPtPerMonth;
    const annualHraExemption = ytdHraExemption + hraExemptionThisMonth + projHraExemptionTotal;

    const remainingMonthsForTds = Math.max(1, Math.min(13 - currentIndex, lastActiveMonthIndex - currentIndex + 1));

    const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
    const section80C =
      (declaration?.lic ?? 0) + (declaration?.epf ?? 0) + (declaration?.ppf ?? 0) + (declaration?.elss ?? 0) +
      (declaration?.lifeInsurance ?? 0) + (declaration?.tuitionFees ?? 0) + (declaration?.housingLoanPrincipal ?? 0) +
      (declaration?.otherSection80C ?? 0) + (declaration?.section80CCC ?? 0) + (declaration?.section80CCD1 ?? 0);

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
    const tdsMonthly = regimeUsed === "OLD" ? oldResult.monthlyTds : newResult.monthlyTds;
    const totalDeductions = totalDeductionsExclTds + tdsMonthly;
    const netSalary = grossSalary - totalDeductions;

    return {
      daysInMonth,
      daysWorked,
      lopDays,
      earnings,
      grossSalary,
      employerContributions,
      totalEmployerCost: grossSalary + totalEmployerContrib,
      deductions,
      tdsMonthly,
      totalDeductions,
      netSalary,
      regimeUsed,
      taxCalcSnapshot: { old: oldResult, new: newResult },
      metrics: { hraExemptionThisMonth, rentPaidThisMonth, prorationFactor },
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
    const result = computeEmployeePayrollLine(db, run.id, employee.id, { lopDays: override.lopDays, variablePay: override.variablePay });
    const existingIdx = run.lines.findIndex((l) => l.employeeId === employee.id);
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
      totalDeductions: result.totalDeductions,
      netSalary: result.netSalary,
      regimeUsed: result.regimeUsed,
      taxCalcSnapshot: result.taxCalcSnapshot,
      metrics: result.metrics,
      adjustments: existingIdx >= 0 ? run.lines[existingIdx].adjustments : [],
    };
    if (existingIdx >= 0) run.lines[existingIdx] = line;
    else run.lines.push(line);
    return line;
  }

  function processPayrollRun(db, runId) {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) throw new Error("Payroll run not found");
    if (run.status === "LOCKED" || run.status === "PAID") {
      throw new Error(`Payroll run is ${run.status} and cannot be recalculated. Use an adjustment instead.`);
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
      throw new Error(`Payroll run is ${run.status} and cannot be recalculated. Use an adjustment instead.`);
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
      throw new Error(`Cannot move payroll run from ${run.status} to ${targetStatus}. Status must advance one step at a time: ${PAYROLL_STATUS_ORDER.join(" -> ")}.`);
    }
    run.status = targetStatus;
    const field = TIMESTAMP_FIELD[targetStatus];
    if (field) run[field] = new Date().toISOString();
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
    const perquisitesAnnualForEstimate = computePerquisitesTotal(db.employeePerquisites.filter((p) => p.employeeId === employeeId && p.financialYearId === financialYearId), fy.startDate).total;

    const earningsAnnual = {}, employerAnnual = {}, deductionAnnual = {};
    for (const c of structure.components) {
      const map = c.category === "EARNING" ? earningsAnnual : c.category === "EMPLOYER_CONTRIBUTION" ? employerAnnual : deductionAnnual;
      map[c.componentCode] = (map[c.componentCode] ?? 0) + c.annualAmount;
    }

    const annualGross = Object.values(earningsAnnual).reduce((s, v) => s + v, 0);
    const basicPlusDaAnnual = sumCodes(earningsAnnual, BASIC_DA_CODES);
    const employerPfNpsSuperAnnual = sumCodes(employerAnnual, PERQ_CHECK_CODES);
    const employerNpsAnnual = employerAnnual["EMPLOYER_NPS"] ?? 0;
    const ptAnnual = deductionAnnual["PROFESSIONAL_TAX"] ?? 0;

    const oldConfig = getTaxRuleSetConfig(db, fy.code, "OLD", asOf);
    const newConfig = getTaxRuleSetConfig(db, fy.code, "NEW", asOf);

    // Summed month-by-month (not monthlyRent x 12) since a declared rent
    // period can start or end partway through the year.
    const fyStartYearForEstimate = new Date(fy.startDate).getFullYear();
    let hraExemptionAnnual = 0;
    for (let m = 1; m <= 12; m++) {
      const { calendarYear: cy, calendarMonth: cm } = fyMonthIndexToCalendar(m, fyStartYearForEstimate);
      const rentActive = isRentActiveInMonth(cy, cm, declaration?.rentStartDate, declaration?.rentEndDate);
      hraExemptionAnnual += monthlyHraExemption(
        { basic: basicPlusDaAnnual / 12, hraReceived: (earningsAnnual["HRA"] ?? 0) / 12, rentPaid: rentActive ? declaration?.monthlyRent ?? 0 : 0, isMetro: employee.isMetroCity },
        oldConfig.hraConfig,
      );
    }

    const previousEmployerTaxableSalary = prevEmployerRows.reduce((s, r) => s + r.taxableSalary, 0);
    const tdsDeductedPreviousEmployer = prevEmployerRows.reduce((s, r) => s + r.tdsDeducted, 0);

    const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
    const section80C =
      (declaration?.lic ?? 0) + (declaration?.epf ?? 0) + (declaration?.ppf ?? 0) + (declaration?.elss ?? 0) +
      (declaration?.lifeInsurance ?? 0) + (declaration?.tuitionFees ?? 0) + (declaration?.housingLoanPrincipal ?? 0) +
      (declaration?.otherSection80C ?? 0) + (declaration?.section80CCC ?? 0) + (declaration?.section80CCD1 ?? 0);

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

    return { old: oldResult, new: newResult, annualGross, hasDeclaration: !!declaration };
  }

  const PayrollEngine = {
    PAYROLL_STATUS_ORDER,
    getTaxRuleSetConfig,
    getActiveStructure,
    computeEmployeePayrollLine,
    isEmployeeEligibleForRun,
    processPayrollRun,
    recalculateLine,
    advancePayrollStatus,
    addAdjustment,
    estimateRegimeComparison,
  };

  if (isNode) {
    module.exports = PayrollEngine;
  } else {
    root.PayrollEngine = PayrollEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
