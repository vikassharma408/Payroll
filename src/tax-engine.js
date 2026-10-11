// Tax engine - ported verbatim (logic-for-logic) from lib/tax-engine/*.ts
// (surcharge.ts, hra.ts, calculate.ts). No framework/DB dependency in the
// original files, so this is a straight type-erasure port - the arithmetic
// and control flow are byte-for-byte the same. Re-verified against the
// same Mr. A/B/C fixtures (see html-app/src/validate-fixtures.js).

/**
 * Surcharge with marginal relief: per the statutory rule, the total of tax +
 * surcharge at the actual income must not exceed (tax + surcharge payable
 * at the threshold income itself) + (the income in excess of the
 * threshold) - i.e. crossing a surcharge threshold can never cost more in
 * extra tax than the extra income itself. At the threshold income the NEXT
 * LOWER band's surcharge still applies (e.g. 10% at exactly Rs 1 crore),
 * so that has to be included - only the lowest (Rs 50 lakh) threshold has
 * no surcharge at all at the threshold. `taxAtIncome(income)` gives slab
 * tax under the SAME slab table (see calculateTax's _slabTax call).
 * `slabsDescending` must be sorted by threshold, highest first.
 */
function computeSurcharge(taxableIncome, taxBeforeSurcharge, slabsDescending, taxAtIncome) {
  for (let i = 0; i < slabsDescending.length; i++) {
    const { threshold, rate } = slabsDescending[i];
    if (taxableIncome > threshold) {
      const fullSurcharge = taxBeforeSurcharge * rate;
      const lowerBandRate = slabsDescending[i + 1] ? slabsDescending[i + 1].rate : 0;
      const taxAtThreshold = Math.round(taxAtIncome(threshold) * (1 + lowerBandRate));
      const reliefCap = Math.max(0, taxableIncome - threshold - (taxBeforeSurcharge - taxAtThreshold));
      const surcharge = Math.round(Math.min(fullSurcharge, reliefCap));
      const marginalReliefApplied = reliefCap < fullSurcharge;
      return {
        surcharge,
        applicableRate: rate,
        marginalReliefApplied,
        steps: [
          `Taxable income Rs ${taxableIncome.toLocaleString("en-IN")} > Rs ${threshold.toLocaleString("en-IN")} => surcharge slab ${rate * 100}%`,
          marginalReliefApplied
            ? `Marginal relief applied: tax+surcharge capped at tax(Rs ${threshold.toLocaleString("en-IN")}) + income over threshold => surcharge = Rs ${surcharge.toLocaleString("en-IN")}`
            : `Surcharge = ${rate * 100}% of tax = Rs ${surcharge.toLocaleString("en-IN")}`,
        ],
      };
    }
  }
  return { surcharge: 0, applicableRate: 0, marginalReliefApplied: false, steps: ["No surcharge applicable"] };
}

/**
 * HRA exemption (old Sec 10(13A), now a new Act Schedule provision - sources
 * disagree on the exact Schedule number) read with Rule 2A: the least of
 * (a) actual HRA received, (b) rent paid minus 10% of Basic+DA,
 * (c) 50%/40% of Basic+DA (metro/non-metro).
 */
function monthlyHraExemption(input, config) {
  const a = input.hraReceived;
  const b = Math.max(input.rentPaid - 0.1 * input.basic, 0);
  const c = (input.isMetro ? config.metroPercent : config.nonMetroPercent) * input.basic;
  return Math.max(0, Math.min(a, b, c));
}

const _taxInr = (n) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

function _slabTax(taxableIncome, slabs, ageCategory) {
  const rows = slabs.filter((s) => s.ageCategory === ageCategory).sort((a, b) => a.order - b.order);
  const breakdown = [];
  let tax = 0;
  for (const slab of rows) {
    if (taxableIncome <= slab.minIncome) continue;
    const upper = slab.maxIncome ?? Infinity;
    const base = Math.min(taxableIncome, upper) - slab.minIncome;
    if (base <= 0) continue;
    const slabTaxAmount = base * slab.rate;
    tax += slabTaxAmount;
    if (slab.rate > 0) {
      breakdown.push({
        label:
          slab.maxIncome == null
            ? `Above Rs ${slab.minIncome.toLocaleString("en-IN")}`
            : `Rs ${slab.minIncome.toLocaleString("en-IN")} - Rs ${slab.maxIncome.toLocaleString("en-IN")}`,
        slabBase: base,
        rate: slab.rate,
        tax: slabTaxAmount,
      });
    }
  }
  return { tax, breakdown };
}

/**
 * Full Old/New regime tax calculation with a step-by-step audit trail.
 * `input` mirrors TaxCalcInput, `config` mirrors TaxRuleSetConfig from the
 * original TypeScript (see html-app/src/rule-configs.js).
 */
function calculateTax(input, config) {
  const steps = [];
  const warnings = [];
  if (config.notes) warnings.push(config.notes);
  for (const rule of config.rules) {
    if (rule.assumptionWarning) warnings.push(`${rule.name} (${rule.section}): ${rule.assumptionWarning}`);
  }

  const isOld = input.regime === "OLD";

  // --- Income from Salary -----------------------------------------------
  // Gross Salary is the base figure everything else adds on top of, so it's
  // listed first; the perquisite/NPS additions below it build up to Total
  // Salary, matching how a payslip or Form 16 computation actually reads.
  const perqExcess = Math.max(0, input.employerPfNpsSuperContribution - config.employerNpsPfPerqLimit);
  if (perqExcess > 0 && input.employerNpsContribution > 0) {
    warnings.push(
      "Employer PF+NPS+Superannuation contributions exceed the combined Rs 7.5 lakh threshold. The employer NPS contribution is fully included in salary u/s 16 (old Sec 17(1)(viii)) and the excess over Rs 7.5 lakh is separately added as a perquisite u/s 17 (old Sec 17(2)(vii)); in rare cases this can overlap for very high combined contributions - review manually.",
    );
  }
  const totalSalaryGross =
    input.grossSalaryCurrentEmployer +
    input.perquisitesOther +
    input.employerNpsContribution +
    perqExcess +
    input.previousEmployerTaxableSalary;
  steps.push({ label: "Gross Salary (current employer)", amount: input.grossSalaryCurrentEmployer });
  if (input.previousEmployerTaxableSalary > 0) {
    steps.push({ label: "Add: Income from Salary - previous employer", amount: input.previousEmployerTaxableSalary });
  }
  if (input.employerNpsContribution > 0) {
    steps.push({
      label: "Employer NPS Contribution (included in salary u/s 16, old Sec 17(1)(viii))",
      amount: input.employerNpsContribution,
    });
  }
  if (perqExcess > 0) {
    steps.push({
      label: "Employer PF+NPS+Superannuation perquisite u/s 17 (old Sec 17(2)(vii))",
      amount: perqExcess,
      note: `Employer contribution ${_taxInr(input.employerPfNpsSuperContribution)} exceeds Rs 7,50,000 limit`,
    });
  }
  steps.push({ label: "Total Salary (before exemptions/deductions)", amount: totalSalaryGross });

  let totalSalaryIncome = totalSalaryGross;
  if (isOld) {
    if (input.hraExemption > 0) {
      totalSalaryIncome -= input.hraExemption;
      steps.push({ label: "Less: HRA Exemption (old Sec 10(13A) - now a new Act Schedule provision)", amount: -input.hraExemption });
    }
    if (input.childrenAllowanceExemption > 0) {
      totalSalaryIncome -= input.childrenAllowanceExemption;
      steps.push({ label: "Less: Children Education / Hostel Allowance exemption (old Sec 10(14), Income-tax Rules 2026)", amount: -input.childrenAllowanceExemption });
    }
    if (input.ltaExemption > 0) {
      totalSalaryIncome -= input.ltaExemption;
      steps.push({ label: "Less: LTA Exemption (old Sec 10(5))", amount: -input.ltaExemption });
    }
    if (input.professionalTaxPaid > 0) {
      totalSalaryIncome -= input.professionalTaxPaid;
      steps.push({ label: "Less: Profession Tax u/s 19 (old Sec 16(iii))", amount: -input.professionalTaxPaid });
    }
  }
  // The standard deduction is "Rs X or the amount of salary, whichever is
  // less" - it can reduce salary income to nil but never below it (which
  // would otherwise wrongly offset house property / other income).
  const standardDeduction = Math.min(config.standardDeduction, Math.max(0, totalSalaryIncome));
  totalSalaryIncome -= standardDeduction;
  steps.push({ label: "Less: Standard Deduction u/s 19 (old Sec 16(ia))", amount: -standardDeduction });
  steps.push({ label: "Income from Salary", amount: totalSalaryIncome });

  // --- Income from House Property -----------------------------------------
  let houseProperty = 0;
  if (isOld && input.selfOccupiedHomeLoanInterest > 0) {
    const capped = Math.min(input.selfOccupiedHomeLoanInterest, config.deductionLimits.HOME_LOAN_SELF_OCCUPIED);
    houseProperty -= capped;
    steps.push({
      label: "Income from House Property (Self-Occupied) - interest u/s 24(b) (unchanged)",
      amount: -capped,
      note:
        capped < input.selfOccupiedHomeLoanInterest
          ? `Capped at Rs ${config.deductionLimits.HOME_LOAN_SELF_OCCUPIED.toLocaleString("en-IN")}`
          : undefined,
    });
  }
  if (input.letOutAnnualValue > 0 || input.letOutMunicipalTax > 0 || input.letOutHomeLoanInterest > 0) {
    const nav = input.letOutAnnualValue - input.letOutMunicipalTax;
    const stdDeduction = nav * 0.3;
    const letOutIncome = nav - stdDeduction - input.letOutHomeLoanInterest;
    houseProperty += letOutIncome;
    steps.push({ label: "Income from House Property (Let-out)", amount: letOutIncome });
  }
  // Sec 115BAC disallows setting off a house property LOSS against any
  // other head of income under the new regime at all (it can only be
  // carried forward to later years) - unlike the old regime, which allows
  // it up to the usual Rs 2,00,000 cap (Sec 71(3A)). A house property
  // PROFIT (houseProperty > 0) is unaffected either way - only a loss is
  // restricted, so capping at 0 here (vs the old regime's real cap) never
  // touches a positive figure.
  const houseCap = isOld ? config.deductionLimits.HOUSE_PROPERTY_LOSS_SETOFF : 0;
  const houseCapped = Math.max(houseProperty, -houseCap);
  if (houseCapped !== houseProperty) {
    warnings.push(
      isOld
        ? `House property loss set-off capped at Rs ${houseCap.toLocaleString("en-IN")} against other income.`
        : "House property loss cannot be set off against other income under the new regime (Sec 115BAC) - excluded here; carry it forward against future house property income instead.",
    );
  }
  if (houseCapped !== 0) {
    steps.push({ label: "Total Income from House Property", amount: houseCapped });
  }

  const grossTotalIncome = totalSalaryIncome + houseCapped + input.otherIncomeDeclared;
  if (input.otherIncomeDeclared > 0) {
    steps.push({ label: "Add: Other Income Declared", amount: input.otherIncomeDeclared });
  }
  steps.push({ label: "Gross Total Income", amount: grossTotalIncome });

  // --- Chapter VI-A deductions --------------------------------------------
  const chapterVIABreakdown = [];
  const dl = config.deductionLimits;
  const d = input.deductions;
  const cappedNpsEmployer = Math.min(d.section80CCD2Employer, config.npsEmployerCapPercent * d.basicPlusDaAnnual);
  chapterVIABreakdown.push({ label: "Sec 124 (old 80CCD(2)) - Employer NPS Contribution", actual: d.section80CCD2Employer, allowed: cappedNpsEmployer });

  let totalDeductions = cappedNpsEmployer;

  if (isOld) {
    const capped80C = Math.min(d.section80C, dl["80C"]);
    const capped80CCD1B = Math.min(d.section80CCD1B, dl["80CCD1B"]);
    const capped80DSelf = Math.min(d.section80DSelfBelow60, dl["80D_SELF_BELOW60"]) +
      Math.min(d.section80DSelfAbove60, dl["80D_SELF_ABOVE60"]);
    const capped80DParents = Math.min(d.section80DParentsBelow60, dl["80D_PARENTS_BELOW60"]) +
      Math.min(d.section80DParentsAbove60, dl["80D_PARENTS_ABOVE60"]);
    const capped80U = Math.min(d.section80UBelow80, dl["80U_BELOW80"]) + Math.min(d.section80U80AndAbove, dl["80U_80PLUS"]);
    const capped80DD = Math.min(d.section80DDBelow80, dl["80DD_BELOW80"]) + Math.min(d.section80DD80AndAbove, dl["80DD_80PLUS"]);
    const capped80EE = Math.min(d.section80EE, dl["80EE"]);
    const capped80EEA = Math.min(d.section80EEA, dl["80EEA"]);

    chapterVIABreakdown.push(
      { label: "Sec 123 (old 80C / 80CCC / 80CCD(1))", actual: d.section80C, allowed: capped80C },
      { label: "Sec 124 (old 80CCD(1B)) - Additional NPS", actual: d.section80CCD1B, allowed: capped80CCD1B },
      { label: "Sec 126 (old 80D) - Medical Insurance", actual: d.section80DSelfBelow60 + d.section80DSelfAbove60 + d.section80DParentsBelow60 + d.section80DParentsAbove60, allowed: capped80DSelf + capped80DParents },
      { label: "Sec 129 (old 80E) - Education Loan Interest", actual: d.section80E, allowed: d.section80E },
      { label: "Sec 130 (old 80EE) - Home Loan Interest (additional)", actual: d.section80EE, allowed: capped80EE },
      { label: "Sec 131 (old 80EEA) - Home Loan Interest (additional)", actual: d.section80EEA, allowed: capped80EEA },
      { label: "Sec 154 (old 80U) - Self Disability", actual: d.section80UBelow80 + d.section80U80AndAbove, allowed: capped80U },
      { label: "Sec 127 (old 80DD) - Dependent Disability", actual: d.section80DDBelow80 + d.section80DD80AndAbove, allowed: capped80DD },
      { label: "Sec 133 (old 80G) - Donations", actual: d.donations80G, allowed: d.donations80G },
      { label: "Other Declared Deductions", actual: d.otherDeductions, allowed: d.otherDeductions },
    );
    totalDeductions +=
      capped80C + capped80CCD1B + capped80DSelf + capped80DParents + d.section80E + capped80EE + capped80EEA +
      capped80U + capped80DD + d.donations80G + d.otherDeductions;
  } else {
    warnings.push("New regime: only Sec 124 (old Sec 80CCD(2)) employer NPS contribution and the standard deduction are applied; all other Chapter VI-A deductions/exemptions are disallowed.");
  }

  steps.push({ label: "Total Deductions under Chapter VI-A", amount: totalDeductions });
  const taxableIncomeRaw = Math.max(0, grossTotalIncome - totalDeductions);
  const taxableIncome = Math.round(taxableIncomeRaw / 10) * 10; // rounding rule, old Sec 288A - new Act section number not found in research, not cited precisely
  steps.push({ label: "Rounded Net Taxable Income (old Sec 288A)", amount: taxableIncome });

  // --- Slab-wise tax --------------------------------------------------------
  const { tax: taxRaw, breakdown: slabBreakdown } = _slabTax(taxableIncome, config.slabs, input.ageCategory);
  for (const row of slabBreakdown) {
    steps.push({
      label: `Slab ${row.label} @ ${row.rate * 100}%`,
      amount: Math.round(row.tax),
      note: `${_taxInr(row.slabBase)} x ${row.rate * 100}%`,
    });
  }
  const taxBeforeRebate = Math.round(taxRaw);
  steps.push({ label: "Income Tax before Rebate", amount: taxBeforeRebate });

  // --- Rebate u/s 87A ---------------------------------------------------
  let rebate = 0;
  if (isOld) {
    if (taxableIncome <= config.rebateLimitOld) {
      rebate = Math.min(taxBeforeRebate, config.rebateMaxOld);
    }
  } else {
    if (taxableIncome <= config.rebateLimitNew) {
      rebate = taxBeforeRebate;
    } else if (config.marginalReliefNew) {
      rebate = Math.max(taxBeforeRebate - (taxableIncome - config.rebateLimitNew), 0);
    }
  }
  rebate = Math.round(rebate);
  if (rebate > 0) steps.push({ label: "Less: Rebate u/s 156 (old Sec 87A)", amount: -rebate });
  const taxAfterRebate = taxBeforeRebate - rebate;
  steps.push({ label: "Tax after Rebate", amount: taxAfterRebate });

  // --- Surcharge ----------------------------------------------------------
  const surchargeResult = computeSurcharge(taxableIncome, taxAfterRebate, config.surchargeConfig, (income) => _slabTax(income, config.slabs, input.ageCategory).tax);
  if (surchargeResult.surcharge > 0) {
    steps.push({ label: "Add: Surcharge", amount: surchargeResult.surcharge, note: surchargeResult.steps.join(" ") });
    if (surchargeResult.marginalReliefApplied) warnings.push("Marginal relief applied on surcharge.");
  }

  // --- Cess -----------------------------------------------------------------
  const cess = Math.round((taxAfterRebate + surchargeResult.surcharge) * config.cessRate);
  steps.push({ label: `Add: Health & Education Cess @ ${config.cessRate * 100}%`, amount: cess });

  const totalTaxLiability = taxAfterRebate + surchargeResult.surcharge + cess;
  steps.push({ label: "Total Tax Liability", amount: totalTaxLiability });

  const tdsAlreadyDeducted = input.tdsAlreadyDeductedCurrentEmployer + input.tdsDeductedPreviousEmployer;
  const balanceTaxPayable = totalTaxLiability - tdsAlreadyDeducted;
  steps.push({ label: "Less: TDS already deducted (current + previous employer)", amount: -tdsAlreadyDeducted });
  steps.push({ label: "Balance Tax Payable", amount: balanceTaxPayable });

  const monthlyTds = input.remainingMonthsInFY > 0 ? Math.max(0, Math.round(balanceTaxPayable / input.remainingMonthsInFY)) : 0;
  steps.push({ label: `Monthly TDS (over ${input.remainingMonthsInFY} remaining month(s))`, amount: monthlyTds });

  return {
    regime: input.regime,
    financialYearCode: config.financialYearCode,
    totalSalaryIncome,
    incomeFromHouseProperty: houseCapped,
    grossTotalIncome,
    totalChapterVIADeductions: totalDeductions,
    chapterVIABreakdown,
    taxableIncome,
    slabBreakdown,
    taxBeforeRebate,
    rebate,
    taxAfterRebate,
    surcharge: surchargeResult.surcharge,
    surchargeMarginalReliefApplied: surchargeResult.marginalReliefApplied,
    cess,
    totalTaxLiability,
    tdsAlreadyDeducted,
    balanceTaxPayable,
    monthlyTds,
    steps,
    warnings,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateTax, computeSurcharge, monthlyHraExemption };
}
