// Standalone validation script (run with `npx tsx lib/tax-engine/__tests__/validate-fixtures.ts`).
// Reproduces "Mr. A" from the user-supplied FY 2026-27 workbook exactly, to
// prove the tax engine matches the company's existing calculator before it
// is trusted for live payroll.
import { calculateTax, type TaxCalcInput } from "../calculate";
import { TAX_RULE_CONFIGS } from "../rule-configs";
import { monthlyHraExemption } from "../hra";

function getConfig(fy: string, regime: "OLD" | "NEW") {
  const c = TAX_RULE_CONFIGS.find((c) => c.financialYearCode === fy && c.regime === regime);
  if (!c) throw new Error(`No config for ${fy} ${regime}`);
  return c;
}

const basicPlusDaAnnual = 420600;
let hraExemptionAnnual = 0;
for (let i = 0; i < 12; i++) {
  hraExemptionAnnual += monthlyHraExemption(
    { basic: basicPlusDaAnnual / 12, hraReceived: 300000 / 12, rentPaid: 0, isMetro: false },
    { metroPercent: 0.5, nonMetroPercent: 0.4 },
  );
}

const baseInput: Omit<TaxCalcInput, "regime"> = {
  ageCategory: "BELOW_60",
  grossSalaryCurrentEmployer: 1475000 - 27600,
  perquisitesOther: 0,
  employerNpsContribution: 27600,
  employerPfNpsSuperContribution: 27600,
  previousEmployerTaxableSalary: 0,
  hraExemption: hraExemptionAnnual,
  professionalTaxPaid: 2500,
  selfOccupiedHomeLoanInterest: 0,
  letOutAnnualValue: 0,
  letOutMunicipalTax: 0,
  letOutHomeLoanInterest: 0,
  otherIncomeDeclared: 0,
  deductions: {
    section80C: 0,
    section80CCD1B: 0,
    section80CCD2Employer: 27600,
    basicPlusDaAnnual,
    section80DSelfBelow60: 0,
    section80DParentsBelow60: 0,
    section80DSelfAbove60: 0,
    section80DParentsAbove60: 0,
    section80E: 0,
    section80EE: 0,
    section80EEA: 0,
    section80UBelow80: 0,
    section80U80AndAbove: 0,
    section80DDBelow80: 0,
    section80DD80AndAbove: 0,
    donations80G: 0,
    otherDeductions: 0,
  },
  tdsAlreadyDeductedCurrentEmployer: 0,
  tdsDeductedPreviousEmployer: 0,
  remainingMonthsInFY: 8,
};

const oldResult = calculateTax({ ...baseInput, regime: "OLD" }, getConfig("2026-27", "OLD"));
const newResult = calculateTax({ ...baseInput, regime: "NEW" }, getConfig("2026-27", "NEW"));

function expect(label: string, actual: number, expected: number) {
  const pass = Math.round(actual) === Math.round(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${label}: expected ${expected}, got ${Math.round(actual)}`);
  if (!pass) process.exitCode = 1;
}

console.log("--- OLD REGIME ---");
expect("Taxable income", oldResult.taxableIncome, 1394900);
expect("Tax before rebate", oldResult.taxBeforeRebate, 230970);
expect("Rebate", oldResult.rebate, 0);
expect("Cess", oldResult.cess, 9239);
expect("Total tax liability", oldResult.totalTaxLiability, 240209);

console.log("--- NEW REGIME ---");
expect("Taxable income", newResult.taxableIncome, 1372400);
expect("Tax before rebate", newResult.taxBeforeRebate, 85860);
expect("Rebate", newResult.rebate, 0);
expect("Cess", newResult.cess, 3434);
expect("Total tax liability", newResult.totalTaxLiability, 89294);

// --- Mr. B: senior citizen (60-79), high income - exercises surcharge -----
const mrBInput: TaxCalcInput = {
  regime: "OLD",
  ageCategory: "SENIOR_60_79",
  grossSalaryCurrentEmployer: 7304000,
  perquisitesOther: 0,
  employerNpsContribution: 0,
  employerPfNpsSuperContribution: 0,
  previousEmployerTaxableSalary: 0,
  hraExemption: 0,
  professionalTaxPaid: 0,
  selfOccupiedHomeLoanInterest: 0,
  letOutAnnualValue: 0,
  letOutMunicipalTax: 0,
  letOutHomeLoanInterest: 0,
  otherIncomeDeclared: 0,
  deductions: { ...baseInput.deductions, section80CCD2Employer: 0, basicPlusDaAnnual: 1542000 },
  tdsAlreadyDeductedCurrentEmployer: 0,
  tdsDeductedPreviousEmployer: 0,
  remainingMonthsInFY: 8,
};
const mrBOld = calculateTax(mrBInput, getConfig("2026-27", "OLD"));
const mrBNew = calculateTax({ ...mrBInput, regime: "NEW" }, getConfig("2026-27", "NEW"));
console.log("\n--- MR. B (senior citizen, high income, surcharge) ---");
expect("Old taxable income", mrBOld.taxableIncome, 7254000);
expect("Old tax before rebate", mrBOld.taxBeforeRebate, 1986200);
expect("Old surcharge", mrBOld.surcharge, 198620);
expect("Old total tax liability", mrBOld.totalTaxLiability, 2272213);
expect("New taxable income", mrBNew.taxableIncome, 7229000);
expect("New tax before rebate", mrBNew.taxBeforeRebate, 1748700);
expect("New surcharge", mrBNew.surcharge, 174870);
expect("New total tax liability", mrBNew.totalTaxLiability, 2000513);

// --- Mr. C: low income - exercises full 87A rebate under the new regime ---
const mrCInput: TaxCalcInput = {
  regime: "OLD",
  ageCategory: "BELOW_60",
  grossSalaryCurrentEmployer: 952000,
  perquisitesOther: 0,
  employerNpsContribution: 0,
  employerPfNpsSuperContribution: 0,
  previousEmployerTaxableSalary: 0,
  hraExemption: 0,
  professionalTaxPaid: 2500,
  selfOccupiedHomeLoanInterest: 0,
  letOutAnnualValue: 0,
  letOutMunicipalTax: 0,
  letOutHomeLoanInterest: 0,
  otherIncomeDeclared: 0,
  deductions: { ...baseInput.deductions, section80CCD2Employer: 0, basicPlusDaAnnual: 298800 },
  tdsAlreadyDeductedCurrentEmployer: 0,
  tdsDeductedPreviousEmployer: 0,
  remainingMonthsInFY: 8,
};
const mrCOld = calculateTax(mrCInput, getConfig("2026-27", "OLD"));
const mrCNew = calculateTax({ ...mrCInput, regime: "NEW" }, getConfig("2026-27", "NEW"));
console.log("\n--- MR. C (low income, full 87A rebate under new regime) ---");
expect("Old taxable income", mrCOld.taxableIncome, 899500);
expect("Old total tax liability", mrCOld.totalTaxLiability, 96096);
expect("New taxable income", mrCNew.taxableIncome, 877000);
expect("New rebate", mrCNew.rebate, 27700);
expect("New total tax liability", mrCNew.totalTaxLiability, 0);

if (process.exitCode === 1) {
  console.error("\nFixture validation FAILED");
} else {
  console.log("\nAll fixtures matched the reference workbook exactly.");
}
