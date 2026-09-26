import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, Card, Badge, Th, Td, Button, inr, EmptyState } from "@/components/ui";
import { PayrollRunActions } from "@/components/payroll-run-actions";
import { FY_MONTH_NAMES, type PayrollStatus } from "@/lib/types";
import Link from "next/link";

export default async function PayrollRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: { financialYear: true, lines: { include: { employee: true }, orderBy: { employee: { employeeCode: "asc" } } } },
  });
  if (!run) notFound();

  const totals = run.lines.reduce(
    (acc, l) => {
      acc.gross += l.grossSalary;
      acc.deductions += l.totalDeductions;
      acc.tds += l.tdsMonthly;
      acc.net += l.netSalary;
      acc.employerCost += l.totalEmployerCost;
      return acc;
    },
    { gross: 0, deductions: 0, tds: 0, net: 0, employerCost: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Payroll Run - ${FY_MONTH_NAMES[run.payrollMonthIndex - 1]} ${run.calendarYear}`}
        description={`FY ${run.financialYear.code} · ${run.payrollGroup ?? "All employees"}`}
        actions={<Badge tone={run.status === "PAID" ? "success" : run.status === "LOCKED" ? "info" : "default"}>{run.status}</Badge>}
      />

      <Card>
        <PayrollRunActions runId={run.id} status={run.status as PayrollStatus} />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card><div className="text-xs text-[var(--muted)]">Employees</div><div className="text-lg font-semibold">{run.lines.length}</div></Card>
        <Card><div className="text-xs text-[var(--muted)]">Gross</div><div className="text-lg font-semibold">{inr(totals.gross)}</div></Card>
        <Card><div className="text-xs text-[var(--muted)]">Deductions</div><div className="text-lg font-semibold">{inr(totals.deductions)}</div></Card>
        <Card><div className="text-xs text-[var(--muted)]">TDS</div><div className="text-lg font-semibold">{inr(totals.tds)}</div></Card>
        <Card><div className="text-xs text-[var(--muted)]">Net</div><div className="text-lg font-semibold">{inr(totals.net)}</div></Card>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button href={`/payroll/${run.id}/register`} variant="secondary">Salary Register</Button>
          <Button href={`/payroll/${run.id}/bank-file`} variant="secondary">Bank Payment File</Button>
          <Button href={`/reports/payroll-audit?runId=${run.id}`} variant="secondary">Audit Report</Button>
        </div>

        {run.lines.length === 0 ? (
          <EmptyState message="No lines yet. Run the payroll calculation above." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>TDS</Th>
                <Th>Net</Th>
                <Th>Regime</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {run.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.employee.employeeCode}</Td>
                  <Td>{l.employee.fullName}</Td>
                  <Td>{inr(l.grossSalary)}</Td>
                  <Td>{inr(l.totalDeductions)}</Td>
                  <Td>{inr(l.tdsMonthly)}</Td>
                  <Td className="font-medium">{inr(l.netSalary)}</Td>
                  <Td><Badge tone="info">{l.regimeUsed}</Badge></Td>
                  <Td>
                    <div className="flex gap-2">
                      <Link href={`/payroll/${run.id}/lines/${l.id}`} className="text-[var(--brand)] hover:underline">
                        Details
                      </Link>
                      <Link href={`/payroll/${run.id}/slips/${l.id}`} className="text-[var(--brand)] hover:underline">
                        Slip
                      </Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
