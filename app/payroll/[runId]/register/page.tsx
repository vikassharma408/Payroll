import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, Card, Button, Th, Td, inr, EmptyState } from "@/components/ui";
import { getSalaryRegisterRows, SALARY_REGISTER_COLUMNS } from "@/lib/reports/salary-register";
import { FY_MONTH_NAMES } from "@/lib/types";

export default async function SalaryRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ department?: string; q?: string }>;
}) {
  const { runId } = await params;
  const { department, q } = await searchParams;
  const run = await prisma.payrollRun.findUnique({ where: { id: runId }, include: { financialYear: true } });
  if (!run) notFound();

  let rows = await getSalaryRegisterRows(runId);
  if (department) rows = rows.filter((r) => r.department === department);
  if (q) rows = rows.filter((r) => r.employeeName.toLowerCase().includes(q.toLowerCase()) || r.employeeCode.toLowerCase().includes(q.toLowerCase()));

  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Monthly Salary Register"
        description={`${FY_MONTH_NAMES[run.payrollMonthIndex - 1]} ${run.calendarYear} · FY ${run.financialYear.code}`}
        actions={
          <>
            <Button href={`/api/payroll/${runId}/register/export?format=xlsx`} variant="secondary">Export Excel</Button>
            <Button href={`/api/payroll/${runId}/register/export?format=csv`} variant="secondary">Export CSV</Button>
          </>
        }
      />

      <Card>
        <form className="flex flex-wrap gap-3" method="get">
          <input name="q" defaultValue={q} placeholder="Search name or code" className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm" />
          <select name="department" defaultValue={department ?? ""} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm">
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
      </Card>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState message="No records for this run." />
        ) : (
          <table>
            <thead>
              <tr>{SALARY_REGISTER_COLUMNS.map((c) => <Th key={c.field}>{c.header}</Th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeCode}>
                  {SALARY_REGISTER_COLUMNS.map((c) => (
                    <Td key={c.field}>{typeof r[c.field] === "number" ? inr(r[c.field] as number) : (r[c.field] as string)}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
