import { notFound } from "next/navigation";
import { getSalarySlipData } from "@/lib/pdf/salary-slip";
import { PageHeader, Card, Button, Th, Td, inr } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { EmailSlipButton } from "@/components/email-slip-button";

const LABELS: Record<string, string> = {
  BASIC: "Basic Salary", DA: "Dearness Allowance", HRA: "House Rent Allowance", SPECIAL_ALLOWANCE: "Special Allowance",
  CONVEYANCE: "Conveyance Allowance", TRANSPORT_ALLOWANCE: "Transport Allowance", MEDICAL_ALLOWANCE: "Medical Allowance",
  LTA: "LTA / LTC", BONUS: "Bonus", INCENTIVE: "Incentive", COMMISSION: "Commission", OVERTIME: "Overtime",
  ARREARS: "Arrears", PERFORMANCE_PAY: "Performance Pay", OTHER_ALLOWANCE: "Other Allowances",
  EMPLOYER_PF: "Employer PF", EMPLOYER_NPS: "Employer NPS", EMPLOYER_SUPERANNUATION: "Employer Superannuation",
  GRATUITY: "Gratuity", OTHER_EMPLOYER_BENEFIT: "Other Employer Benefit", EMPLOYEE_PF: "Employee PF",
  EMPLOYEE_ESI: "Employee ESI", PROFESSIONAL_TAX: "Professional Tax", LWF: "LWF", SALARY_ADVANCE: "Salary Advance",
  LOAN_RECOVERY: "Loan Recovery", OTHER_DEDUCTION: "Other Deduction",
};

function mask(acc: string | null) {
  if (!acc) return "-";
  if (acc.length <= 4) return acc;
  return "X".repeat(acc.length - 4) + acc.slice(-4);
}

export default async function SlipPage({ params }: { params: Promise<{ runId: string; lineId: string }> }) {
  const { runId, lineId } = await params;
  let data;
  try {
    data = await getSalarySlipData(lineId);
  } catch {
    notFound();
  }
  const earnings = JSON.parse(data.line.earnings) as Record<string, number>;
  const employerContrib = JSON.parse(data.line.employerContributions) as Record<string, number>;
  const deductions = JSON.parse(data.line.deductions) as Record<string, number>;

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        <PageHeader
          title="Salary Slip"
          description={`${data.employee.fullName} · ${data.monthLabel}`}
          actions={
            <>
              <Button href={`/api/payroll/${runId}/lines/${lineId}/slip`} variant="secondary">Download PDF</Button>
              <PrintButton />
              <EmailSlipButton lineId={lineId} />
            </>
          }
        />
      </div>

      <Card>
        <div className="mb-4 flex items-start justify-between border-b border-[var(--border)] pb-3">
          <div>
            <div className="text-lg font-bold">{data.company?.name}</div>
            <div className="text-xs text-[var(--muted)]">{data.company?.address}</div>
            <div className="text-xs text-[var(--muted)]">PAN: {data.company?.pan} · TAN: {data.company?.tan}</div>
          </div>
          <div className="text-right text-xs text-[var(--muted)]">
            <div>Payslip for {data.monthLabel}</div>
            <div>FY {data.fyLabel}</div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-4">
          <div><span className="text-[var(--muted)]">Employee Code:</span> {data.employee.employeeCode}</div>
          <div><span className="text-[var(--muted)]">Name:</span> {data.employee.fullName}</div>
          <div><span className="text-[var(--muted)]">Designation:</span> {data.employee.designation ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Department:</span> {data.employee.department ?? "-"}</div>
          <div><span className="text-[var(--muted)]">PAN:</span> {data.employee.pan ?? "-"}</div>
          <div><span className="text-[var(--muted)]">UAN:</span> {data.employee.uan ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Bank Account:</span> {mask(data.employee.bankAccountNo)}</div>
          <div><span className="text-[var(--muted)]">Days Worked:</span> {data.line.daysWorked}/{data.line.daysInMonth} (LOP {data.line.lopDays})</div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Earnings</div>
            <table>
              <tbody>
                {Object.entries(earnings).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
                ))}
                <tr className="font-semibold"><Td>Gross Salary</Td><Td className="text-right">{inr(data.line.grossSalary)}</Td></tr>
              </tbody>
            </table>
            <div className="mb-1 mt-3 text-xs font-semibold uppercase text-[var(--muted)]">Employer Contributions</div>
            <table>
              <tbody>
                {Object.entries(employerContrib).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Deductions</div>
            <table>
              <tbody>
                {Object.entries(deductions).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td className="text-right">{inr(v)}</Td></tr>
                ))}
                <tr><Td>TDS</Td><Td className="text-right">{inr(data.line.tdsMonthly)}</Td></tr>
                <tr className="font-semibold"><Td>Total Deductions</Td><Td className="text-right">{inr(data.line.totalDeductions)}</Td></tr>
              </tbody>
            </table>
            <div className="mb-1 mt-3 text-xs font-semibold uppercase text-[var(--muted)]">Tax Summary</div>
            <div className="text-sm">Regime: {data.line.regimeUsed} · Annual Tax Liability: {inr(data.annualTaxLiability)}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-md bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] px-4 py-3">
          <span className="font-medium">Net Salary Payable</span>
          <span className="text-xl font-bold text-[var(--brand-dark)]">{inr(data.line.netSalary)}</span>
        </div>

        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Year-to-Date (FY {data.fyLabel})</div>
          <table>
            <thead><tr><Th>Gross (YTD)</Th><Th>Deductions (YTD)</Th><Th>TDS (YTD)</Th><Th>Net (YTD)</Th></tr></thead>
            <tbody>
              <tr>
                <Td>{inr(data.ytd.gross)}</Td>
                <Td>{inr(data.ytd.deductions)}</Td>
                <Td>{inr(data.ytd.tds)}</Td>
                <Td>{inr(data.ytd.net)}</Td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center text-xs text-[var(--muted)]">This is a system-generated payslip and does not require a signature.</div>
      </Card>
    </div>
  );
}
