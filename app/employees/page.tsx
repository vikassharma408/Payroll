import { prisma } from "@/lib/db";
import { PageHeader, Card, Button, Badge, Th, Td, EmptyState } from "@/components/ui";
import Link from "next/link";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; department?: string; status?: string }> }) {
  const { q, department, status } = await searchParams;

  const employees = await prisma.employee.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { fullName: { contains: q } },
                { employeeCode: { contains: q } },
                { pan: { contains: q } },
              ],
            }
          : {},
        department ? { department } : {},
        status ? { status } : {},
      ],
    },
    orderBy: { employeeCode: "asc" },
  });
  const departments = await prisma.employee.findMany({ select: { department: true }, distinct: ["department"] });

  return (
    <div>
      <PageHeader
        title="Employee Master"
        description={`${employees.length} employee(s)`}
        actions={<Button href="/employees/new">+ Add Employee</Button>}
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--muted)]">Search</label>
            <input name="q" defaultValue={q} placeholder="Name, code or PAN" className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--muted)]">Department</label>
            <select name="department" defaultValue={department ?? ""} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm">
              <option value="">All</option>
              {departments.map((d) => d.department && <option key={d.department} value={d.department}>{d.department}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--muted)]">Status</label>
            <select name="status" defaultValue={status ?? ""} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="LEFT">Left</option>
            </select>
          </div>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
      </Card>

      <Card>
        {employees.length === 0 ? (
          <EmptyState message="No employees found. Add one or use the Import Wizard for bulk upload." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                <Th>Regime</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <Td>{e.employeeCode}</Td>
                  <Td>{e.fullName}</Td>
                  <Td>{e.department ?? "-"}</Td>
                  <Td>{e.designation ?? "-"}</Td>
                  <Td><Badge tone="info">{e.taxRegime}</Badge></Td>
                  <Td><Badge tone={e.status === "ACTIVE" ? "success" : e.status === "LEFT" ? "warning" : "default"}>{e.status}</Badge></Td>
                  <Td>
                    <Link href={`/employees/${e.id}`} className="text-[var(--brand)] hover:underline">
                      View
                    </Link>
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
