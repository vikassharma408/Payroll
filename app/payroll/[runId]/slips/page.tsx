import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, Card, Th, Td, Button } from "@/components/ui";

export default async function SlipsListPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { employee: true }, orderBy: { employee: { employeeCode: "asc" } } } },
  });
  if (!run) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Salary Slips" description="Select an employee to view/download their payslip" />
      <Card>
        <table>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th></Th></tr>
          </thead>
          <tbody>
            {run.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.employee.employeeCode}</Td>
                <Td>{l.employee.fullName}</Td>
                <Td><Button href={`/payroll/${runId}/slips/${l.id}`} variant="ghost">View Slip</Button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
