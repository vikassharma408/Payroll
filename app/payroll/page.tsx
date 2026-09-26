import { prisma } from "@/lib/db";
import { PageHeader, Card, Badge, Th, Td, Button, Field, inputClass, EmptyState } from "@/components/ui";
import { createPayrollRun } from "@/lib/actions/payroll";
import { FY_MONTH_NAMES } from "@/lib/types";

export default async function PayrollListPage() {
  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "asc" } });
  const currentFy = financialYears.find((f) => f.isCurrent) ?? financialYears[financialYears.length - 1];
  const runs = await prisma.payrollRun.findMany({
    include: { financialYear: true, lines: true },
    orderBy: [{ financialYearId: "desc" }, { payrollMonthIndex: "desc" }],
  });

  async function handleCreate(formData: FormData) {
    "use server";
    await createPayrollRun(formData);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payroll Runs" description="Process monthly payroll and track workflow status" />

      <Card>
        <div className="mb-3 text-sm font-semibold">Create / Open a Payroll Run</div>
        <form action={handleCreate} className="flex flex-wrap items-end gap-3">
          <Field label="Financial Year">
            <select name="financialYearId" defaultValue={currentFy?.id} className={inputClass}>
              {financialYears.map((f) => (
                <option key={f.id} value={f.id}>FY {f.code}</option>
              ))}
            </select>
          </Field>
          <Field label="Payroll Month">
            <select name="payrollMonthIndex" className={inputClass}>
              {FY_MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Payroll Group" hint="Leave blank for all employees">
            <input name="payrollGroup" className={inputClass} placeholder="e.g. MONTHLY" />
          </Field>
          <Button type="submit">Create / Open Run</Button>
        </form>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">All Runs</div>
        {runs.length === 0 ? (
          <EmptyState message="No payroll runs yet." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>FY</Th>
                <Th>Month</Th>
                <Th>Group</Th>
                <Th>Employees</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td>{r.financialYear.code}</Td>
                  <Td>{FY_MONTH_NAMES[r.payrollMonthIndex - 1]} {r.calendarYear}</Td>
                  <Td>{r.payrollGroup ?? "All"}</Td>
                  <Td>{r.lines.length}</Td>
                  <Td>
                    <Badge tone={r.status === "PAID" ? "success" : r.status === "LOCKED" ? "info" : r.status === "DRAFT" ? "default" : "warning"}>{r.status}</Badge>
                  </Td>
                  <Td>
                    <Button href={`/payroll/${r.id}`} variant="ghost">Open</Button>
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
