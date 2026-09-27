import { Card, Th, Td, inr, EmptyState } from "@/components/ui";
import { TaxCalcView } from "@/components/tax-calc-view";
import type { RegimeEstimateResult } from "@/lib/payroll/estimate";

export function RegimeEstimateCard({
  estimate,
  financialYearCode,
}: {
  estimate: RegimeEstimateResult | null;
  financialYearCode: string;
}) {
  if (!estimate) {
    return (
      <Card>
        <div className="mb-2 text-sm font-semibold">Tax Regime Comparison - FY {financialYearCode}</div>
        <EmptyState message="Set up a Salary Structure above first to see a regime comparison for this employee." />
      </Card>
    );
  }

  const { old: oldResult, new: newResult } = estimate;
  const beneficial = oldResult.totalTaxLiability <= newResult.totalTaxLiability ? "Old" : "New";
  const difference = Math.abs(oldResult.totalTaxLiability - newResult.totalTaxLiability);

  return (
    <Card>
      <div className="mb-1 text-sm font-semibold">Tax Regime Comparison - FY {financialYearCode}</div>
      <p className="mb-3 text-xs text-[var(--ivory-dim)]">
        Projected for the full financial year from the current Salary Structure, Investment Declaration and Previous
        Employer records (annual gross {inr(estimate.annualGross)}). This is an estimate, independent of any payroll
        run - it will differ slightly from actual payroll once LOP, variable pay and YTD actuals are factored in.
      </p>

      <table>
        <thead>
          <tr>
            <Th>Particulars</Th>
            <Th>Old Regime</Th>
            <Th>New Regime</Th>
          </tr>
        </thead>
        <tbody>
          <tr><Td>Gross Total Income</Td><Td>{inr(oldResult.grossTotalIncome)}</Td><Td>{inr(newResult.grossTotalIncome)}</Td></tr>
          <tr><Td>Chapter VI-A Deductions</Td><Td>{inr(oldResult.totalChapterVIADeductions)}</Td><Td>{inr(newResult.totalChapterVIADeductions)}</Td></tr>
          <tr><Td>Taxable Income</Td><Td>{inr(oldResult.taxableIncome)}</Td><Td>{inr(newResult.taxableIncome)}</Td></tr>
          <tr><Td>Income Tax (before rebate)</Td><Td>{inr(oldResult.taxBeforeRebate)}</Td><Td>{inr(newResult.taxBeforeRebate)}</Td></tr>
          <tr><Td>Rebate u/s 87A</Td><Td>{inr(oldResult.rebate)}</Td><Td>{inr(newResult.rebate)}</Td></tr>
          <tr><Td>Surcharge</Td><Td>{inr(oldResult.surcharge)}</Td><Td>{inr(newResult.surcharge)}</Td></tr>
          <tr><Td>Health &amp; Education Cess</Td><Td>{inr(oldResult.cess)}</Td><Td>{inr(newResult.cess)}</Td></tr>
          <tr className="font-semibold"><Td>Annual Tax Liability</Td><Td>{inr(oldResult.totalTaxLiability)}</Td><Td>{inr(newResult.totalTaxLiability)}</Td></tr>
          <tr><Td>Estimated Monthly TDS</Td><Td>{inr(oldResult.monthlyTds)}</Td><Td>{inr(newResult.monthlyTds)}</Td></tr>
        </tbody>
      </table>

      <div className="mt-3 text-sm">
        Difference between regimes: <span className="font-semibold">{inr(difference)}</span> ({beneficial} regime results in lower tax at today&apos;s declarations)
      </div>

      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <div className="flex-1"><TaxCalcView result={oldResult} label="Old Regime" /></div>
        <div className="flex-1"><TaxCalcView result={newResult} label="New Regime" /></div>
      </div>
    </Card>
  );
}
