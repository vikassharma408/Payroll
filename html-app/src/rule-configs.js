// Tax rule configuration - ported verbatim from lib/tax-engine/rule-configs.ts.
// Config-driven, not hard-coded into the engine: a new FY just needs a new
// entry here. See that file's history for the FY 2026-27 research notes -
// summary: independently verified in September 2026 against multiple
// sources (ClearTax, Bajaj Finserv, Bankbazaar, TaxGuru, Canara HSBC Life,
// Axis Max Life) and the user-supplied FY 2026-27 workbook; all confirmed
// unchanged for FY 2026-27. One citation-only change: effective 1 April
// 2026 the Income-tax Act 2025 replaces the 1961 Act (old Sec 87A = new
// Sec 156); this app still cites the 1961 numbering elsewhere since it
// remains universally recognized and other renumbering was inconsistently
// reported across sources.

const OLD_REGIME_SLABS_BASE = [
  { minIncome: 0, maxIncome: 250000, rate: 0, order: 1 },
  { minIncome: 250000, maxIncome: 500000, rate: 0.05, order: 2 },
  { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 3 },
  { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 4 },
];

function oldRegimeSlabs() {
  return [
    ...OLD_REGIME_SLABS_BASE.map((s) => ({ ...s, ageCategory: "BELOW_60" })),
    { minIncome: 0, maxIncome: 300000, rate: 0, order: 1, ageCategory: "SENIOR_60_79" },
    { minIncome: 300000, maxIncome: 500000, rate: 0.05, order: 2, ageCategory: "SENIOR_60_79" },
    { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 3, ageCategory: "SENIOR_60_79" },
    { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 4, ageCategory: "SENIOR_60_79" },
    { minIncome: 0, maxIncome: 500000, rate: 0, order: 1, ageCategory: "SUPER_SENIOR_80_PLUS" },
    { minIncome: 500000, maxIncome: 1000000, rate: 0.2, order: 2, ageCategory: "SUPER_SENIOR_80_PLUS" },
    { minIncome: 1000000, maxIncome: null, rate: 0.3, order: 3, ageCategory: "SUPER_SENIOR_80_PLUS" },
  ];
}

function newRegimeSlabs(bands) {
  const ages = ["BELOW_60", "SENIOR_60_79", "SUPER_SENIOR_80_PLUS"];
  return ages.flatMap((ageCategory) => bands.map((b, i) => ({ ...b, ageCategory, order: i + 1 })));
}

const OLD_SURCHARGE = [
  { threshold: 50000000, rate: 0.37 },
  { threshold: 20000000, rate: 0.25 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 5000000, rate: 0.1 },
];

const NEW_SURCHARGE = [
  { threshold: 20000000, rate: 0.25 },
  { threshold: 10000000, rate: 0.15 },
  { threshold: 5000000, rate: 0.1 },
];

const DEDUCTION_LIMITS = {
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

const HRA_CONFIG = { metroPercent: 0.5, nonMetroPercent: 0.4 };

function commonRules(regime, cessRate) {
  const rules = [
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
      { name: "Standard Deduction", section: "Sec 16(ia)", calculationMethod: "Flat deduction from salary income", limitValue: 50000 },
      { name: "Profession Tax deduction", section: "Sec 16(iii)", calculationMethod: "Profession tax actually paid, deducted from salary income" },
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
        calculationMethod: "Least of: actual HRA received; rent paid - 10% of Basic+DA; 50% (metro) / 40% (non-metro) of Basic+DA. Computed month-wise and aggregated.",
      },
      { name: "Section 80C / 80CCC / 80CCD(1)", section: "Sec 80C, 80CCC, 80CCD(1)", calculationMethod: "Aggregate of eligible investments, capped", limitValue: 150000 },
      { name: "Section 80CCD(1B)", section: "Sec 80CCD(1B)", calculationMethod: "Additional NPS employee contribution, capped", limitValue: 50000 },
      { name: "Section 80D", section: "Sec 80D", calculationMethod: "Medical insurance premium, capped by age band for self/family and parents" },
      { name: "Section 80E", section: "Sec 80E", calculationMethod: "Interest on education loan, no upper limit (allowed for 8 years)" },
      { name: "Section 80EE / 80EEA", section: "Sec 80EE / 80EEA", calculationMethod: "Additional home loan interest deduction for first-time buyers, capped" },
      { name: "Section 80U / 80DD", section: "Sec 80U / 80DD", calculationMethod: "Disability deduction, flat amount by severity band (not expenditure-linked)" },
      {
        name: "Section 80G Donations",
        section: "Sec 80G",
        calculationMethod: "Modeled as fully deductible in this engine",
        assumptionWarning: "Actual 80G deduction depends on the donee's category (50%/100% deduction, with or without a qualifying-income limit). Verify the exact eligible amount per donation before relying on this figure.",
      },
      { name: "Home Loan Interest (Self-Occupied)", section: "Sec 24(b)", calculationMethod: "Interest on housing loan for self-occupied property, capped", limitValue: 200000 },
      { name: "House Property Loss Set-off", section: "Sec 71(3A)", calculationMethod: "Loss from house property set off against salary income, capped per year", limitValue: 200000 },
    );
  } else {
    rules.push(
      { name: "Standard Deduction", section: "Sec 16(ia)", calculationMethod: "Flat deduction from salary income (higher than the old regime)" },
      {
        name: "Rebate u/s 87A",
        section: "Sec 87A (Income-tax Act 1961) / Sec 156 (Income-tax Act 2025)",
        calculationMethod: "Full tax rebated if taxable income does not exceed the threshold; marginal relief applies just above it so tax never exceeds income over the threshold.",
      },
      { name: "Section 80CCD(2)", section: "Sec 80CCD(2)", calculationMethod: "Employer NPS contribution, capped as % of Basic+DA - one of the few deductions allowed under the new regime" },
      {
        name: "Chapter VI-A deductions (80C/80D/HRA/LTA etc.)",
        section: "Chapter VI-A",
        calculationMethod: "Not allowed under the new regime",
        assumptionWarning: "Most Chapter VI-A deductions and salary exemptions (80C, 80D, HRA, LTA, home loan interest) are disallowed under the new regime; only the standard deduction and Sec 80CCD(2) employer NPS contribution are applied here.",
      },
    );
  }
  rules.push({
    name: "Employer PF/NPS/Superannuation combined perquisite",
    section: "Sec 17(2)(vii)",
    calculationMethod: "Employer contribution to PF + NPS + Superannuation fund in excess of Rs 7.5 lakh in a year is a taxable perquisite (both regimes).",
    limitValue: 750000,
  });
  return rules;
}

function buildRuleSet(params) {
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

const NEW_REGIME_SLAB_BANDS_2025 = [
  { minIncome: 0, maxIncome: 400000, rate: 0 },
  { minIncome: 400000, maxIncome: 800000, rate: 0.05 },
  { minIncome: 800000, maxIncome: 1200000, rate: 0.1 },
  { minIncome: 1200000, maxIncome: 1600000, rate: 0.15 },
  { minIncome: 1600000, maxIncome: 2000000, rate: 0.2 },
  { minIncome: 2000000, maxIncome: 2400000, rate: 0.25 },
  { minIncome: 2400000, maxIncome: null, rate: 0.3 },
];

function buildOldNewPair(financialYearCode, effectiveFrom) {
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
const [FY2027_28_OLD, FY2027_28_NEW] = buildOldNewPair("2027-28", "2027-04-01");
FY2027_28_OLD.notes =
  "PROVISIONAL: No Finance Act has been passed for FY 2027-28 yet. Parameters are carried forward from FY 2026-27 as a placeholder - update this rule set as soon as the applicable Budget/Finance Act is enacted.";
FY2027_28_NEW.notes = FY2027_28_OLD.notes;

const TAX_RULE_CONFIGS = [FY2026_27_OLD, FY2026_27_NEW, FY2027_28_OLD, FY2027_28_NEW];

const FINANCIAL_YEARS = [
  { code: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31", isCurrent: true },
  { code: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", isCurrent: false },
];

function getTaxRuleSetConfig(financialYearCode, regime, asOfDateIso) {
  const candidates = TAX_RULE_CONFIGS.filter((c) => c.financialYearCode === financialYearCode && c.regime === regime);
  if (candidates.length === 0) {
    throw new Error(`No tax rule set found for FY ${financialYearCode} (${regime} regime). Configure it under Tax Rules.`);
  }
  const asOf = asOfDateIso ? new Date(asOfDateIso) : new Date(8640000000000000);
  const eligible = candidates.filter((c) => new Date(c.effectiveFrom) <= asOf).sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
  return eligible[0] ?? candidates[0];
}

/** Age category as on 31 March of the financial year (standard convention for slab eligibility). */
function deriveAgeCategory(dobIso, fyEndDateIso) {
  if (!dobIso) return "BELOW_60";
  const dob = new Date(dobIso);
  const fyEndDate = new Date(fyEndDateIso);
  let age = fyEndDate.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    fyEndDate.getMonth() > dob.getMonth() || (fyEndDate.getMonth() === dob.getMonth() && fyEndDate.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  if (age >= 80) return "SUPER_SENIOR_80_PLUS";
  if (age >= 60) return "SENIOR_60_79";
  return "BELOW_60";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TAX_RULE_CONFIGS, FINANCIAL_YEARS, getTaxRuleSetConfig, deriveAgeCategory };
}
