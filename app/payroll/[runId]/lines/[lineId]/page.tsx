import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, Card, Badge, Th, Td, inr, Button } from "@/components/ui";
import { TaxCalcView } from "@/components/tax-calc-view";
import { AdjustmentForm } from "@/components/adjustment-form";
import type { TaxCalcResult } from "@/lib/tax-engine/calculate";

const LABELS: Record<string, string> = {
  BASIC: "Basic",
  DA: "Dearness Allowance",
  HRA: "HRA",
  SPECIAL_ALLOWANCE: "Special Allowance",
  CONVEYANCE: "Conveyance",
  TRANSPORT_ALLOWANCE: "Transport Allowance",
  MEDICAL_ALLOWANCE: "Medical Allowance",
  LTA: "LTA",
  BONUS: "Bonus",
  INCENTIVE: "Incentive",
  COMMISSION: "Commission",
  OVERTIME: "Overtime",
  ARREARS: "Arrears",
  PERFORMANCE_PAY: "Performance Pay",
  OTHER_ALLOWANCE: "Other Allowances",
  EMPLOYER_PF: "Employer PF",
  EMPLOYER_NPS: "Employer NPS",
  EMPLOYER_SUPERANNUATION: "Employer Superannuation",
  GRATUITY: "Gratuity",
  OTHER_EMPLOYER_BENEFIT: "Other Employer Benefit",
  EMPLOYEE_PF: "Employee PF",
  EMPLOYEE_ESI: "Employee ESI",
  PROFESSIONAL_TAX: "Professional Tax",
  LWF: "LWF",
  SALARY_ADVANCE: "Salary Advance",
  LOAN_RECOVERY: "Loan Recovery",
  OTHER_DEDUCTION: "Other Deduction",
};

export default async function PayrollLineDetailPage({ params }: { params: Promise<{ runId: string; lineId: string }> }) {
  const { runId, lineId } = await params;
  const line = await prisma.payrollRunLine.findUnique({
    where: { id: lineId },
    include: { employee: true, payrollRun: { include: { financialYear: true } }, adjustments: { orderBy: { createdAt: "asc" } } },
  });
  if (!line || line.payrollRunId !== runId) notFound();

  const earnings = JSON.parse(line.earnings) as Record<string, number>;
  const employerContrib = JSON.parse(line.employerContributions) as Record<string, number>;
  const deductions = JSON.parse(line.deductions) as Record<string, number>;
  const snapshot = JSON.parse(line.taxCalcSnapshot) as { old: TaxCalcResult; new: TaxCalcResult };

  const beneficial = snapshot.old.totalTaxLiability <= snapshot.new.totalTaxLiability ? "Old" : "New";
  const difference = Math.abs(snapshot.old.totalTaxLiability - snapshot.new.totalTaxLiability);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={line.employee.fullName}
        description={`${line.employee.employeeCode} · Days worked ${line.daysWorked}/${line.daysInMonth} · LOP ${line.lopDays}`}
        actions={
          <>
            <Badge tone="info">Selected: {line.regimeUsed} Regime</Badge>
            <Button href={`/payroll/${runId}/slips/${line.id}`} variant="secondary">View Payslip</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-2 text-sm font-semibold">Earnings</div>
          <table>
            <tbody>
              {Object.entries(earnings).filter(([, v]) => v !== 0).map(([k, v]) => (
                <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
              ))}
              <tr className="font-semibold"><Td>Gross Salary</Td><Td className="text-right">{inr(line.grossSalary)}</Td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="mb-2 text-sm font-semibold">Deductions</div>
          <table>
            <tbody>
              {Object.entries(deductions).filter(([, v]) => v !== 0).map(([k, v]) => (
                <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
              ))}
              <tr><Td>TDS (this month)</Td><Td className="text-right">{inr(line.tdsMonthly)}</Td></tr>
              <tr className="font-semibold"><Td>Total Deductions</Td><Td className="text-right">{inr(line.totalDeductions)}</Td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="mb-2 text-sm font-semibold">Employer Contributions</div>
          <table>
            <tbody>
              {Object.entries(employerContrib).filter(([, v]) => v !== 0).map(([k, v]) => (
                <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
              ))}
              <tr className="font-semibold"><Td>Total CTC (this month)</Td><Td className="text-right">{inr(line.totalEmployerCost)}</Td></tr>
            </tbody>
          </table>
        </Card>
        <Card className="flex flex-col justify-center bg-blue-50">
          <div className="text-sm text-[var(--muted)]">Net Salary</div>
          <div className="text-3xl font-bold text-[var(--brand-dark)]">{inr(line.netSalary)}</div>
        </Card>
      </div>

      <Card>
        <div className="mb-3 text-sm font-semibold">Old vs New Regime Comparison (Annual, Projected)</div>
        <table>
          <thead>
            <tr>
              <Th>Particulars</Th>
              <Th>Old Regime</Th>
              <Th>New Regime</Th>
            </tr>
          </thead>
          <tbody>
            <tr><Td>Gross Total Income</Td><Td>{inr(snapshot.old.grossTotalIncome)}</Td><Td>{inr(snapshot.new.grossTotalIncome)}</Td></tr>
            <tr><Td>Chapter VI-A Deductions</Td><Td>{inr(snapshot.old.totalChapterVIADeductions)}</Td><Td>{inr(snapshot.new.totalChapterVIADeductions)}</Td></tr>
            <tr><Td>Taxable Income</Td><Td>{inr(snapshot.old.taxableIncome)}</Td><Td>{inr(snapshot.new.taxableIncome)}</Td></tr>
            <tr><Td>Income Tax (before rebate)</Td><Td>{inr(snapshot.old.taxBeforeRebate)}</Td><Td>{inr(snapshot.new.taxBeforeRebate)}</Td></tr>
            <tr><Td>Rebate u/s 87A</Td><Td>{inr(snapshot.old.rebate)}</Td><Td>{inr(snapshot.new.rebate)}</Td></tr>
            <tr><Td>Surcharge</Td><Td>{inr(snapshot.old.surcharge)}</Td><Td>{inr(snapshot.new.surcharge)}</Td></tr>
            <tr><Td>Health &amp; Education Cess</Td><Td>{inr(snapshot.old.cess)}</Td><Td>{inr(snapshot.new.cess)}</Td></tr>
            <tr className="font-semibold"><Td>Annual Tax Liability</Td><Td>{inr(snapshot.old.totalTaxLiability)}</Td><Td>{inr(snapshot.new.totalTaxLiability)}</Td></tr>
            <tr><Td>TDS already deducted</Td><Td>{inr(snapshot.old.tdsAlreadyDeducted)}</Td><Td>{inr(snapshot.new.tdsAlreadyDeducted)}</Td></tr>
            <tr><Td>Balance TDS</Td><Td>{inr(snapshot.old.balanceTaxPayable)}</Td><Td>{inr(snapshot.new.balanceTaxPayable)}</Td></tr>
            <tr><Td>Monthly TDS</Td><Td>{inr(snapshot.old.monthlyTds)}</Td><Td>{inr(snapshot.new.monthlyTds)}</Td></tr>
          </tbody>
        </table>
        <div className="mt-3 text-sm">
          Difference between regimes: <span className="font-semibold">{inr(difference)}</span> ({beneficial} regime results in lower tax for this employee)
        </div>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <div className="flex-1"><TaxCalcView result={snapshot.old} label="Old Regime" /></div>
          <div className="flex-1"><TaxCalcView result={snapshot.new} label="New Regime" /></div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">Manual Adjustments</div>
        {line.adjustments.length > 0 && (
          <table className="mb-3">
            <thead>
              <tr><Th>Amount</Th><Th>Reason</Th><Th>Entered By</Th><Th>Date/Time</Th></tr>
            </thead>
            <tbody>
              {line.adjustments.map((a) => (
                <tr key={a.id}>
                  <Td>{inr(a.amount)}</Td>
                  <Td>{a.reason}</Td>
                  <Td>{a.enteredBy}</Td>
                  <Td>{a.createdAt.toISOString().replace("T", " ").slice(0, 16)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AdjustmentForm payrollRunLineId={line.id} />
      </Card>
    </div>
  );
}
