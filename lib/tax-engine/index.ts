import { prisma } from "@/lib/db";
import type {
  AgeCategory,
  DeductionLimits,
  HraConfig,
  Regime,
  SurchargeSlabConfig,
  TaxRuleSetConfig,
} from "@/lib/types";

export { calculateTax } from "./calculate";
export type { TaxCalcInput, TaxCalcResult, TaxCalcDeductionsInput } from "./calculate";
export { monthlyHraExemption } from "./hra";
export { TAX_RULE_CONFIGS, FINANCIAL_YEARS } from "./rule-configs";

/** Resolves the tax rule set in force for a FY+regime as of a given date (defaults to the FY end). */
export async function getTaxRuleSetConfig(
  financialYearCode: string,
  regime: Regime,
  asOfDate?: Date,
): Promise<TaxRuleSetConfig> {
  const fy = await prisma.financialYear.findUnique({ where: { code: financialYearCode } });
  if (!fy) throw new Error(`Unknown financial year '${financialYearCode}'. Add it under Tax Rules first.`);
  const effectiveDate = asOfDate ?? fy.endDate;

  const ruleSet = await prisma.taxRuleSet.findFirst({
    where: {
      financialYearId: fy.id,
      regime,
      isActive: true,
      effectiveFrom: { lte: effectiveDate },
    },
    orderBy: { effectiveFrom: "desc" },
    include: { slabs: true, rules: true },
  });
  if (!ruleSet) {
    throw new Error(
      `No tax rule set found for FY ${financialYearCode} (${regime} regime) effective on or before ${effectiveDate.toISOString().slice(0, 10)}. Configure it under Tax Rules.`,
    );
  }

  return {
    financialYearCode,
    regime: ruleSet.regime as Regime,
    effectiveFrom: ruleSet.effectiveFrom.toISOString().slice(0, 10),
    standardDeduction: ruleSet.standardDeduction,
    cessRate: ruleSet.cessRate,
    rebateLimitOld: ruleSet.rebateLimitOld,
    rebateMaxOld: ruleSet.rebateMaxOld,
    rebateLimitNew: ruleSet.rebateLimitNew,
    marginalReliefNew: ruleSet.marginalReliefNew,
    npsEmployerCapPercent: ruleSet.npsEmployerCapPercent,
    employerNpsPfPerqLimit: ruleSet.employerNpsPfPerqLimit,
    surchargeConfig: JSON.parse(ruleSet.surchargeConfig) as SurchargeSlabConfig[],
    deductionLimits: JSON.parse(ruleSet.deductionLimits) as DeductionLimits,
    hraConfig: JSON.parse(ruleSet.hraConfig) as HraConfig,
    notes: ruleSet.notes ?? undefined,
    slabs: ruleSet.slabs.map((s) => ({
      ageCategory: s.ageCategory as AgeCategory,
      minIncome: s.minIncome,
      maxIncome: s.maxIncome,
      rate: s.rate,
      order: s.order,
    })),
    rules: ruleSet.rules.map((r) => ({
      name: r.name,
      section: r.section,
      calculationMethod: r.calculationMethod,
      limitValue: r.limitValue ?? undefined,
      rateValue: r.rateValue ?? undefined,
      assumptionWarning: r.assumptionWarning ?? undefined,
    })),
  };
}

/** Age category as on 31 March of the financial year (standard convention for slab eligibility). */
export function deriveAgeCategory(dob: Date | null, fyEndDate: Date): AgeCategory {
  if (!dob) return "BELOW_60";
  let age = fyEndDate.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    fyEndDate.getMonth() > dob.getMonth() ||
    (fyEndDate.getMonth() === dob.getMonth() && fyEndDate.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  if (age >= 80) return "SUPER_SENIOR_80_PLUS";
  if (age >= 60) return "SENIOR_60_79";
  return "BELOW_60";
}
