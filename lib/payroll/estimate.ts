import { prisma } from "@/lib/db";
import { calculateTax, type TaxCalcInput, type TaxCalcResult } from "@/lib/tax-engine/calculate";
import { getTaxRuleSetConfig, deriveAgeCategory } from "@/lib/tax-engine";
import { monthlyHraExemption } from "@/lib/tax-engine/hra";
import type { Regime } from "@/lib/types";

const PERQ_CHECK_CODES = ["EMPLOYER_PF", "EMPLOYER_NPS", "EMPLOYER_SUPERANNUATION"];
const BASIC_DA_CODES = ["BASIC", "DA"];

function sum(map: Record<string, number>, codes: string[]) {
  return codes.reduce((s, c) => s + (map[c] ?? 0), 0);
}

export interface RegimeEstimateResult {
  old: TaxCalcResult;
  new: TaxCalcResult;
  annualGross: number;
  hasDeclaration: boolean;
}

/**
 * Projects a full-year Old vs New regime comparison directly from the
 * active Salary Structure + Investment Declaration + Previous Employer
 * records for a FY - independent of any payroll run ever having been
 * processed. Assumes the current structure applies for the whole FY (no
 * YTD actuals to blend in, since none exist yet). Returns null if there is
 * no active salary structure for that employee/FY to project from.
 */
export async function estimateRegimeComparison(
  employeeId: string,
  financialYearId: string,
): Promise<RegimeEstimateResult | null> {
  const [employee, fy, structure, declaration, prevEmployerRows] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId } }),
    prisma.financialYear.findUniqueOrThrow({ where: { id: financialYearId } }),
    prisma.employeeSalaryStructure.findFirst({
      where: { employeeId, financialYearId, isActive: true },
      orderBy: { effectiveFrom: "desc" },
      include: { components: { include: { component: true } } },
    }),
    prisma.investmentDeclaration.findUnique({ where: { employeeId_financialYearId: { employeeId, financialYearId } } }),
    prisma.previousEmployerIncome.findMany({ where: { employeeId, financialYearId } }),
  ]);

  if (!structure) return null;

  const earningsAnnual: Record<string, number> = {};
  const employerAnnual: Record<string, number> = {};
  const deductionAnnual: Record<string, number> = {};
  for (const c of structure.components) {
    const map =
      c.component.category === "EARNING" ? earningsAnnual : c.component.category === "EMPLOYER_CONTRIBUTION" ? employerAnnual : deductionAnnual;
    map[c.component.code] = (map[c.component.code] ?? 0) + c.annualAmount;
  }

  const annualGross = Object.values(earningsAnnual).reduce((s, v) => s + v, 0);
  const basicPlusDaAnnual = sum(earningsAnnual, BASIC_DA_CODES);
  const employerPfNpsSuperAnnual = sum(employerAnnual, PERQ_CHECK_CODES);
  const employerNpsAnnual = employerAnnual["EMPLOYER_NPS"] ?? 0;
  const ptAnnual = deductionAnnual["PROFESSIONAL_TAX"] ?? 0;

  const [oldConfig, newConfig] = await Promise.all([
    getTaxRuleSetConfig(fy.code, "OLD", fy.endDate),
    getTaxRuleSetConfig(fy.code, "NEW", fy.endDate),
  ]);

  // Monthly figures are constant across the projected year, so calling the
  // month-wise HRA formula once with annual totals gives the same result as
  // summing 12 identical months (min() distributes over a positive scalar).
  const hraExemptionAnnual = monthlyHraExemption(
    {
      basic: basicPlusDaAnnual,
      hraReceived: earningsAnnual["HRA"] ?? 0,
      rentPaid: (declaration?.monthlyRent ?? 0) * 12,
      isMetro: employee.isMetroCity,
    },
    oldConfig.hraConfig,
  );

  const previousEmployerTaxableSalary = prevEmployerRows.reduce((s, r) => s + r.taxableSalary, 0);
  const tdsDeductedPreviousEmployer = prevEmployerRows.reduce((s, r) => s + r.tdsDeducted, 0);

  const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
  const section80C =
    (declaration?.lic ?? 0) +
    (declaration?.epf ?? 0) +
    (declaration?.ppf ?? 0) +
    (declaration?.elss ?? 0) +
    (declaration?.lifeInsurance ?? 0) +
    (declaration?.tuitionFees ?? 0) +
    (declaration?.housingLoanPrincipal ?? 0) +
    (declaration?.otherSection80C ?? 0) +
    (declaration?.section80CCC ?? 0) +
    (declaration?.section80CCD1 ?? 0);

  function buildInput(regime: Regime): TaxCalcInput {
    return {
      regime,
      ageCategory,
      grossSalaryCurrentEmployer: annualGross,
      perquisitesOther: 0,
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
    const note =
      "No Investment Declaration is on file for this FY yet - the Old Regime figures below assume zero Chapter VI-A deductions/HRA rent, so they may look worse than reality. Fill in the Investment Declaration for an accurate comparison.";
    oldResult.warnings.unshift(note);
  }

  return { old: oldResult, new: newResult, annualGross, hasDeclaration: !!declaration };
}
