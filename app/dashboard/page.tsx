import { prisma } from "@/lib/db";
import { getDashboardData } from "@/lib/dashboard";
import { PageHeader, StatCard, Card, Badge, inr } from "@/components/ui";
import { PayrollTrendCharts } from "@/components/dashboard-charts";
import Link from "next/link";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const { fy: fyCode } = await searchParams;
  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "asc" } });
  const fy = fyCode ? financialYears.find((f) => f.code === fyCode) : financialYears.find((f) => f.isCurrent);
  const activeFy = fy ?? financialYears[financialYears.length - 1];

  if (!activeFy) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <Card>No financial year configured yet. Visit Tax Rules to set one up (seed script sets this up automatically).</Card>
      </div>
    );
  }

  const data = await getDashboardData(activeFy.id);

  return (
    <div>
      <PageHeader
        title="Payroll Dashboard"
        description={`Financial Year ${activeFy.code}`}
        actions={
          <div className="flex gap-1">
            {financialYears.map((f) => (
              <Link
                key={f.id}
                href={`/dashboard?fy=${f.code}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${f.id === activeFy.id ? "border-[var(--brand)] bg-blue-50 text-[var(--brand)]" : "border-[var(--border)] bg-white"}`}
              >
                FY {f.code}
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Employees" value={String(data.totalEmployees)} />
        <StatCard label="Processed (latest run)" value={String(data.employeesProcessed)} />
        <StatCard label="Pending" value={String(data.employeesPending)} />
        <StatCard label="Payroll Runs" value={String(data.runs.length)} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Gross Salary (latest)" value={inr(data.totals.gross)} />
        <StatCard label="Total Deductions" value={inr(data.totals.deductions)} />
        <StatCard label="Total TDS" value={inr(data.totals.tds)} />
        <StatCard label="Net Salary" value={inr(data.totals.net)} />
        <StatCard label="Employee PF" value={inr(data.totals.employeePf)} />
        <StatCard label="Employer PF" value={inr(data.totals.employerPf)} />
        <StatCard label="Employer Cost" value={inr(data.totals.employerCost)} />
        <StatCard label="Total Payroll Cost" value={inr(data.totals.net + data.totals.deductions + (data.totals.employerCost - data.totals.gross))} />
      </div>

      <div className="mb-6">
        <PayrollTrendCharts data={data.monthlyTrend} />
      </div>

      <Card>
        <div className="mb-3 text-sm font-semibold">Payroll Runs this Financial Year</div>
        <table>
          <thead>
            <tr className="text-left text-xs uppercase text-[var(--muted)]">
              <th className="py-1">Month</th>
              <th className="py-1">Status</th>
              <th className="py-1">Employees</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="py-1.5">{r.calendarMonth}/{r.calendarYear}</td>
                <td className="py-1.5">
                  <Badge tone={r.status === "PAID" ? "success" : r.status === "LOCKED" ? "info" : r.status === "DRAFT" ? "default" : "warning"}>{r.status}</Badge>
                </td>
                <td className="py-1.5">{r.lines.length}</td>
                <td className="py-1.5">
                  <Link href={`/payroll/${r.id}`} className="text-[var(--brand)] hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
