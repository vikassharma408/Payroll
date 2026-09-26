import type {
  DeductionLimits,
  HraConfig,
  Regime,
  SurchargeSlabConfig,
  TaxRuleMeta,
  TaxRuleSetConfig,
  TaxSlabConfig,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared building blocks (unchanged across the FYs modeled here). Every value
// is still attached to a specific TaxRuleSetConfig below, so a future FY with
// a different limit only requires a new config object - nothing here is
// hard-coded into the calculation engine itself (see lib/tax-engine/calculate.ts).
// ---------------------------------------------------------------------------

const OLD_REGIME_SLABS_BASE: Omit<TaxSlabConfig, "ageCategory">[] = [
  { minIncome: 0, maxIncome: 250000, rate: 0, order: 1 },
  { minIncome: 250000, maxIncome: 500000, rate: 0.05, order: 2 },
  { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 3 },
  { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 4 },
];

function oldRegimeSlabs(): TaxSlabConfig[] {
  return [
    ...OLD_REGIME_SLABS_BASE.map((s) => ({ ...s, ageCategory: "BELOW_60" as const })),
    { minIncome: 0, maxIncome: 300000, rate: 0, order: 1, ageCategory: "SENIOR_60_79" as const },
    { minIncome: 300000, maxIncome: 500000, rate: 0.05, order: 2, ageCategory: "SENIOR_60_79" as const },
    { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 3, ageCategory: "SENIOR_60_79" as const },
    { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 4, ageCategory: "SENIOR_60_79" as const },
    { minIncome: 0, maxIncome: 500000, rate: 0, order: 1, ageCategory: "SUPER_SENIOR_80_PLUS" as const },
    { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 2, ageCategory: "SUPER_SENIOR_80_PLUS" as const },
    { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 3, ageCategory: "SUPER_SENIOR_80_PLUS" as const },
  ];
}

// New regime slabs are age-independent by law; the same bands are stored
// under all three age categories so the engine can use one lookup path.
function newRegimeSlabs(bands: { minIncome: number; maxIncome: number | null; rate: number }[]): TaxSlabConfig[] {
  const ages: TaxSlabConfig["ageCategory"][] = ["BELOW_60", "SENIOR_60_79", "SUPER_SENIOR_80_PLUS"];
  return ages.flatMap((ageCategory) =>
    bands.map((b, i) => ({ ...b, ageCategory, order: i + 1 })),
  );
}

const OLD_SURCHARGE: SurchargeSlabConfig[] = [
  { threshold: 50000000, rate: 0.37 },
  { threshold: 20000000, rate: 0.25 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 5000000, rate: 0.1 },
];

// New regime surcharge is capped at 25% (no 37% slab) since FY 2023-24.
const NEW_SURCHARGE: SurchargeSlabConfig[] = [
  { threshold: 20000000, rate: 0.25 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 5000000, rate: 0.1 },
];

const DEDUCTION_LIMITS: DeductionLimits = {
  "80C": 150000,
  "80CCD1B": 50000,
  "80D_SELF_BELOW60": 25000,
  "80D_PARENTS_BELOW60": 25000,
  "80D_SELF_ABOVE60": 50000,
  "80D_PARENTS_ABOVE60": 50000,
  "80U_BELOW80": 75000,
  "80U_80PLUS": 125000,
  "80DD_BELOW80": 75000,
  "80DD_80PLUS": 125000,
  "80EE": 50000,
  "80EEA": 150000,
  HOME_LOAN_SELF_OCCUPIED: 200000,
  HOUSE_PROPERTY_LOSS_SETOFF: 200000,
};

const HRA_CONFIG: HraConfig = { metroPercent: 0.5, nonMetroPercent: 0.4 };

function commonRules(regime: Regime, cessRate: number): TaxRuleMeta[] {
  const rules: TaxRuleMeta[] = [
    {
      name: "Health & Education Cess",
      section: "Sec 87(surcharge)/Finance Act",
      calculationMethod: "4% of (Income Tax after rebate + Surcharge)",
      rateValue: cessRate,
    },
    {
      name: "Surcharge",
      section: "Finance Act - Part III, Schedule I",
      calculationMethod:
        "Slab-wise surcharge on tax, with marginal relief so surcharge+tax increase never exceeds the increase in income beyond the threshold.",
    },
  ];
  if (regime === "OLD") {
    rules.push(
      {
        name: "Standard Deduction",
        section: "Sec 16(ia)",
        calculationMethod: "Flat deduction from salary income",
        limitValue: 50000,
      },
      {
        name: "Profession Tax deduction",
        section: "Sec 16(iii)",
        calculationMethod: "Profession tax actually paid, deducted from salary income",
      },
      {
        name: "Rebate u/s 87A",
        section: "Sec 87A (Income-tax Act 1961) / Sec 156 (Income-tax Act 2025)",
        calculationMethod: "Full tax rebated (max Rs 12,500) if taxable income <= Rs 5,00,000",
        limitValue: 500000,
        rateValue: 12500,
      },
      {
        name: "HRA Exemption",
        section: "Sec 10(13A) read with Rule 2A",
        calculationMethod:
          "Least of: actual HRA received; rent paid - 10% of Basic+DA; 50% (metro) / 40% (non-metro) of Basic+DA. Computed month-wise and aggregated.",
      },
      {
        name: "Section 80C / 80CCC / 80CCD(1)",
        section: "Sec 80C, 80CCC, 80CCD(1)",
        calculationMethod: "Aggregate of eligible investments, capped",
        limitValue: 150000,
      },
      {
        name: "Section 80CCD(1B)",
        section: "Sec 80CCD(1B)",
        calculationMethod: "Additional NPS employee contribution, capped",
        limitValue: 50000,
      },
      {
        name: "Section 80D",
        section: "Sec 80D",
        calculationMethod: "Medical insurance premium, capped by age band for self/family and parents",
      },
      {
        name: "Section 80E",
        section: "Sec 80E",
        calculationMethod: "Interest on education loan, no upper limit (allowed for 8 years)",
      },
      {
        name: "Section 80EE / 80EEA",
        section: "Sec 80EE / 80EEA",
        calculationMethod: "Additional home loan interest deduction for first-time buyers, capped",
      },
      {
        name: "Section 80U / 80DD",
        section: "Sec 80U / 80DD",
        calculationMethod: "Disability deduction, flat amount by severity band (not expenditure-linked)",
      },
      {
        name: "Section 80G Donations",
        section: "Sec 80G",
        calculationMethod: "Modeled as fully deductible in this engine",
        assumptionWarning:
          "Actual 80G deduction depends on the donee's category (50%/100% deduction, with or without a qualifying-income limit). Verify the exact eligible amount per donation before relying on this figure.",
      },
      {
        name: "Home Loan Interest (Self-Occupied)",
        section: "Sec 24(b)",
        calculationMethod: "Interest on housing loan for self-occupied property, capped",
        limitValue: 200000,
      },
      {
        name: "House Property Loss Set-off",
        section: "Sec 71(3A)",
        calculationMethod: "Loss from house property set off against salary income, capped per year",
        limitValue: 200000,
      },
    );
  } else {
    rules.push(
      {
        name: "Standard Deduction",
        section: "Sec 16(ia)",
        calculationMethod: "Flat deduction from salary income (higher than the old regime)",
      },
      {
        name: "Rebate u/s 87A",
        section: "Sec 87A (Income-tax Act 1961) / Sec 156 (Income-tax Act 2025)",
        calculationMethod:
          "Full tax rebated if taxable income does not exceed the threshold; marginal relief applies just above it so tax never exceeds income over the threshold.",
      },
      {
        name: "Section 80CCD(2)",
        section: "Sec 80CCD(2)",
        calculationMethod: "Employer NPS contribution, capped as % of Basic+DA - one of the few deductions allowed under the new regime",
      },
      {
        name: "Chapter VI-A deductions (80C/80D/HRA/LTA etc.)",
        section: "Chapter VI-A",
        calculationMethod: "Not allowed under the new regime",
        assumptionWarning:
          "Most Chapter VI-A deductions and salary exemptions (80C, 80D, HRA, LTA, home loan interest) are disallowed under the new regime; only the standard deduction and Sec 80CCD(2) employer NPS contribution are applied here.",
      },
    );
  }
  rules.push({
    name: "Employer PF/NPS/Superannuation combined perquisite",
    section: "Sec 17(2)(vii)",
    calculationMethod:
      "Employer contribution to PF + NPS + Superannuation fund in excess of Rs 7.5 lakh in a year is a taxable perquisite (both regimes).",
    limitValue: 750000,
  });
  return rules;
}

function buildRuleSet(params: {
  financialYearCode: string;
  regime: Regime;
  effectiveFrom: string;
  standardDeduction: number;
  rebateLimitOld: number;
  rebateMaxOld: number;
  rebateLimitNew: number;
  npsEmployerCapPercent: number;
  surchargeConfig: SurchargeSlabConfig[];
  slabs: TaxSlabConfig[];
  notes?: string;
}): TaxRuleSetConfig {
  return {
    financialYearCode: params.financialYearCode,
    regime: params.regime,
    effectiveFrom: params.effectiveFrom,
    standardDeduction: params.standardDeduction,
    cessRate: 0.04,
    rebateLimitOld: params.rebateLimitOld,
    rebateMaxOld: params.rebateMaxOld,
    rebateLimitNew: params.rebateLimitNew,
    marginalReliefNew: true,
    npsEmployerCapPercent: params.npsEmployerCapPercent,
    employerNpsPfPerqLimit: 750000,
    surchargeConfig: params.surchargeConfig,
    deductionLimits: DEDUCTION_LIMITS,
    hraConfig: HRA_CONFIG,
    notes: params.notes,
    slabs: params.slabs,
    rules: commonRules(params.regime, 0.04),
  };
}

// ---------------------------------------------------------------------------
// FY 2026-27 onward only - this app does not model years before FY 2026-27.
//
// New regime slabs/rebate per the Finance Act 2025 (Budget presented Feb
// 2025), continued unchanged into FY 2026-27 by the Union Budget 2026 (which
// made no changes to slabs, the standard deduction, or Chapter VI-A limits).
// Independently verified in September 2026 via web research across multiple
// sources (ClearTax, Bajaj Finserv, Bankbazaar, TaxGuru, Canara HSBC Life,
// Axis Max Life, and others), cross-checked against each other, in addition
// to the user-supplied FY 2026-27 salary/TDS workbook (Mr. A: New regime
// annual tax liability Rs 89,294 on taxable income Rs 13,72,400; Old regime
// Rs 2,40,209 on taxable income Rs 13,94,900), which the engine reproduces
// exactly (see lib/tax-engine/__tests__). Confirmed unchanged for FY 2026-27:
// both regimes' slabs, standard deduction (Rs 75,000 new / Rs 50,000 old),
// Sec 87A rebate (new regime: full rebate up to Rs 12L taxable income, i.e.
// up to Rs 60,000 of tax, with marginal relief just above; old regime: up to
// Rs 12,500 at <= Rs 5L), surcharge slabs/marginal relief, cess rate (4%),
// Sec 80C/80D/80CCD(1B) limits, Sec 80CCD(2) employer NPS cap (10% old / 14%
// new regime of Basic+DA), and the Sec 17(2)(vii) Rs 7.5L combined employer
// PF+NPS+superannuation perquisite threshold.
//
// One structural change *was* found: effective 1 April 2026, the
// Income-tax Act, 2025 replaces the Income-tax Act, 1961, renumbering
// sections (verified: old Sec 87A = new Sec 156). Rates/limits are
// unaffected - only citations change. This app cites the historical 1961
// Act section numbers throughout (e.g. "Sec 80C", "Sec 10(13A)") since they
// remain the numbers every Indian payroll/tax professional recognizes, and
// multiple secondary sources gave inconsistent numbers for the 2025 Act's
// renumbering of provisions beyond Sec 87A/156. Cross-check the Income-tax
// Act, 2025 itself for exact new section numbers before using this for
// statutory filings or disclosures that must cite the current Act.
// ---------------------------------------------------------------------------
const NEW_REGIME_SLAB_BANDS_2025 = [
  { minIncome: 0, maxIncome: 400000, rate: 0 },
  { minIncome: 400000, maxIncome: 800000, rate: 0.05 },
  { minIncome: 800000, maxIncome: 1200000, rate: 0.1 },
  { minIncome: 1200000, maxIncome: 1600000, rate: 0.15 },
  { minIncome: 1600000, maxIncome: 2000000, rate: 0.2 },
  { minIncome: 2000000, maxIncome: 2400000, rate: 0.25 },
  { minIncome: 2400000, maxIncome: null, rate: 0.3 },
];

function buildOldNewPair(financialYearCode: string, effectiveFrom: string): [TaxRuleSetConfig, TaxRuleSetConfig] {
  const old = buildRuleSet({
    financialYearCode,
    regime: "OLD",
    effectiveFrom,
    standardDeduction: 50000,
    rebateLimitOld: 500000,
    rebateMaxOld: 12500,
    rebateLimitNew: 1200000,
    npsEmployerCapPercent: 0.1,
    surchargeConfig: OLD_SURCHARGE,
    slabs: oldRegimeSlabs(),
  });
  const newR = buildRuleSet({
    financialYearCode,
    regime: "NEW",
    effectiveFrom,
    standardDeduction: 75000,
    rebateLimitOld: 500000,
    rebateMaxOld: 12500,
    rebateLimitNew: 1200000,
    npsEmployerCapPercent: 0.14,
    surchargeConfig: NEW_SURCHARGE,
    slabs: newRegimeSlabs(NEW_REGIME_SLAB_BANDS_2025),
  });
  return [old, newR];
}

const [FY2026_27_OLD, FY2026_27_NEW] = buildOldNewPair("2026-27", "2026-04-01");

// FY 2027-28: no Finance Act has been passed for this year yet at the time
// this engine was built. We roll forward the FY 2026-27 parameters as a
// placeholder so the FY selector and payroll workflow are not blocked, but
// this MUST be reviewed and replaced once the applicable Budget is passed -
// surfaced as an assumption warning in the UI (see lib/tax-engine/index.ts).
const [FY2027_28_OLD, FY2027_28_NEW] = buildOldNewPair("2027-28", "2027-04-01");
FY2027_28_OLD.notes =
  "PROVISIONAL: No Finance Act has been passed for FY 2027-28 yet. Parameters are carried forward from FY 2026-27 as a placeholder - update this rule set as soon as the applicable Budget/Finance Act is enacted.";
FY2027_28_NEW.notes = FY2027_28_OLD.notes;

export const TAX_RULE_CONFIGS: TaxRuleSetConfig[] = [
  FY2026_27_OLD,
  FY2026_27_NEW,
  FY2027_28_OLD,
  FY2027_28_NEW,
];

export const FINANCIAL_YEARS = [
  { code: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31", isCurrent: true },
  { code: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", isCurrent: false },
];
