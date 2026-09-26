import type { AgeCategory, Regime, TaxRuleSetConfig } from "@/lib/types";
import { computeSurcharge } from "./surcharge";

export interface TaxCalcDeductionsInput {
  section80C: number; // raw actual: LIC+PF+PPF+ELSS+life+tuition+home loan principal+80CCC+80CCD1
  section80CCD1B: number;
  section80CCD2Employer: number; // actual employer NPS contribution for the year
  basicPlusDaAnnual: number; // basis for the 80CCD(2) cap
  section80DSelfBelow60: number;
  section80DParentsBelow60: number;
  section80DSelfAbove60: number;
  section80DParentsAbove60: number;
  section80E: number;
  section80EE: number;
  section80EEA: number;
  section80UBelow80: number;
  section80U80AndAbove: number;
  section80DDBelow80: number;
  section80DD80AndAbove: number;
  donations80G: number;
  otherDeductions: number;
}

export interface TaxCalcInput {
  regime: Regime;
  ageCategory: AgeCategory;
  grossSalaryCurrentEmployer: number;
  perquisitesOther: number;
  employerNpsContribution: number; // annual employer NPS contribution - fully included in "salary" u/s 17(1)(viii)
  employerPfNpsSuperContribution: number; // annual combined PF+NPS+Superannuation, for the Sec 17(2)(vii) 7.5L combined-perquisite excess check
  previousEmployerTaxableSalary: number; // Form 12B: previous employer's net "Income from Salary" for the FY
  hraExemption: number; // pre-computed (payroll builds this month-wise via lib/tax-engine/hra.ts); old regime only
  professionalTaxPaid: number;
  selfOccupiedHomeLoanInterest: number; // old regime only
  letOutAnnualValue: number;
  letOutMunicipalTax: number;
  letOutHomeLoanInterest: number;
  otherIncomeDeclared: number;
  deductions: TaxCalcDeductionsInput;
  tdsAlreadyDeductedCurrentEmployer: number;
  tdsDeductedPreviousEmployer: number;
  remainingMonthsInFY: number;
}

export interface SlabBreakdownRow {
  label: string;
  slabBase: number;
  rate: number;
  tax: number;
}

export interface TaxCalcStep {
  label: string;
  amount?: number;
  note?: string;
}

export interface TaxCalcResult {
  regime: Regime;
  financialYearCode: string;
  totalSalaryIncome: number;
  incomeFromHouseProperty: number;
  grossTotalIncome: number;
  totalChapterVIADeductions: number;
  chapterVIABreakdown: { label: string; actual: number; allowed: number }[];
  taxableIncome: number;
  slabBreakdown: SlabBreakdownRow[];
  taxBeforeRebate: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  surchargeMarginalReliefApplied: boolean;
  cess: number;
  totalTaxLiability: number;
  tdsAlreadyDeducted: number;
  balanceTaxPayable: number;
  monthlyTds: number;
  steps: TaxCalcStep[];
  warnings: string[];
}

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

function slabTax(taxableIncome: number, slabs: TaxRuleSetConfig["slabs"], ageCategory: AgeCategory) {
  const rows = slabs
    .filter((s) => s.ageCategory === ageCategory)
    .sort((a, b) => a.order - b.order);
  const breakdown: SlabBreakdownRow[] = [];
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

export function calculateTax(input: TaxCalcInput, config: TaxRuleSetConfig): TaxCalcResult {
  const steps: TaxCalcStep[] = [];
  const warnings: string[] = [];
  if (config.notes) warnings.push(config.notes);
  for (const rule of config.rules) {
    if (rule.assumptionWarning) warnings.push(`${rule.name} (${rule.section}): ${rule.assumptionWarning}`);
  }

  const isOld = input.regime === "OLD";

  // --- Income from Salary -----------------------------------------------
  const perqExcess = Math.max(0, input.employerPfNpsSuperContribution - config.employerNpsPfPerqLimit);
  if (perqExcess > 0) {
    steps.push({
      label: "Employer PF+NPS+Superannuation perquisite u/s 17(2)(vii)",
      amount: perqExcess,
      note: `Employer contribution ${inr(input.employerPfNpsSuperContribution)} exceeds Rs 7,50,000 limit`,
    });
    if (input.employerNpsContribution > 0) {
      warnings.push(
        "Employer PF+NPS+Superannuation contributions exceed the combined Rs 7.5 lakh threshold. The employer NPS contribution is fully included in salary u/s 17(1)(viii) and the excess over Rs 7.5 lakh is separately added as a perquisite u/s 17(2)(vii); in rare cases this can overlap for very high combined contributions - review manually.",
      );
    }
  }
  if (input.employerNpsContribution > 0) {
    steps.push({
      label: "Employer NPS Contribution (included in salary u/s 17(1)(viii))",
      amount: input.employerNpsContribution,
    });
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
  steps.push({ label: "Total Salary (before exemptions/deductions)", amount: totalSalaryGross });

  let totalSalaryIncome = totalSalaryGross;
  if (isOld) {
    if (input.hraExemption > 0) {
      totalSalaryIncome -= input.hraExemption;
      steps.push({ label: "Less: HRA Exemption u/s 10(13A)", amount: -input.hraExemption });
    }
    if (input.professionalTaxPaid > 0) {
      totalSalaryIncome -= input.professionalTaxPaid;
      steps.push({ label: "Less: Profession Tax u/s 16(iii)", amount: -input.professionalTaxPaid });
    }
  }
  totalSalaryIncome -= config.standardDeduction;
  steps.push({ label: "Less: Standard Deduction u/s 16(ia)", amount: -config.standardDeduction });
  steps.push({ label: "Income from Salary", amount: totalSalaryIncome });

  // --- Income from House Property -----------------------------------------
  let houseProperty = 0;
  if (isOld && input.selfOccupiedHomeLoanInterest > 0) {
    const capped = Math.min(input.selfOccupiedHomeLoanInterest, config.deductionLimits.HOME_LOAN_SELF_OCCUPIED);
    houseProperty -= capped;
    steps.push({
      label: "Income from House Property (Self-Occupied) - interest u/s 24(b)",
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
  const houseCap = config.deductionLimits.HOUSE_PROPERTY_LOSS_SETOFF;
  const houseCapped = Math.max(houseProperty, -houseCap);
  if (houseCapped !== houseProperty) {
    warnings.push(`House property loss set-off capped at Rs ${houseCap.toLocaleString("en-IN")} against other income.`);
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
  const chapterVIABreakdown: { label: string; actual: number; allowed: number }[] = [];
  const dl = config.deductionLimits;
  const d = input.deductions;
  const cappedNpsEmployer = Math.min(d.section80CCD2Employer, config.npsEmployerCapPercent * d.basicPlusDaAnnual);
  chapterVIABreakdown.push({ label: "80CCD(2) - Employer NPS Contribution", actual: d.section80CCD2Employer, allowed: cappedNpsEmployer });

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
      { label: "80C / 80CCC / 80CCD(1)", actual: d.section80C, allowed: capped80C },
      { label: "80CCD(1B) - Additional NPS", actual: d.section80CCD1B, allowed: capped80CCD1B },
      { label: "80D - Medical Insurance", actual: d.section80DSelfBelow60 + d.section80DSelfAbove60 + d.section80DParentsBelow60 + d.section80DParentsAbove60, allowed: capped80DSelf + capped80DParents },
      { label: "80E - Education Loan Interest", actual: d.section80E, allowed: d.section80E },
      { label: "80EE - Home Loan Interest (additional)", actual: d.section80EE, allowed: capped80EE },
      { label: "80EEA - Home Loan Interest (additional)", actual: d.section80EEA, allowed: capped80EEA },
      { label: "80U - Self Disability", actual: d.section80UBelow80 + d.section80U80AndAbove, allowed: capped80U },
      { label: "80DD - Dependent Disability", actual: d.section80DDBelow80 + d.section80DD80AndAbove, allowed: capped80DD },
      { label: "80G - Donations", actual: d.donations80G, allowed: d.donations80G },
      { label: "Other Declared Deductions", actual: d.otherDeductions, allowed: d.otherDeductions },
    );
    totalDeductions +=
      capped80C + capped80CCD1B + capped80DSelf + capped80DParents + d.section80E + capped80EE + capped80EEA +
      capped80U + capped80DD + d.donations80G + d.otherDeductions;
  } else {
    warnings.push("New regime: only Sec 80CCD(2) employer NPS contribution and the standard deduction are applied; all other Chapter VI-A deductions/exemptions are disallowed.");
  }

  steps.push({ label: "Total Deductions under Chapter VI-A", amount: totalDeductions });
  const taxableIncomeRaw = Math.max(0, grossTotalIncome - totalDeductions);
  const taxableIncome = Math.round(taxableIncomeRaw / 10) * 10; // Sec 288A rounding
  steps.push({ label: "Rounded Net Taxable Income u/s 288A", amount: taxableIncome });

  // --- Slab-wise tax --------------------------------------------------------
  const { tax: taxRaw, breakdown: slabBreakdown } = slabTax(taxableIncome, config.slabs, input.ageCategory);
  for (const row of slabBreakdown) {
    steps.push({
      label: `Slab ${row.label} @ ${row.rate * 100}%`,
      amount: Math.round(row.tax),
      note: `${inr(row.slabBase)} x ${row.rate * 100}%`,
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
  if (rebate > 0) steps.push({ label: "Less: Rebate u/s 87A", amount: -rebate });
  const taxAfterRebate = taxBeforeRebate - rebate;
  steps.push({ label: "Tax after Rebate", amount: taxAfterRebate });

  // --- Surcharge ----------------------------------------------------------
  const surchargeResult = computeSurcharge(taxableIncome, taxAfterRebate, config.surchargeConfig);
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
