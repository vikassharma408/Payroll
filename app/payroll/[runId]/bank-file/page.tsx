import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader, Card, Button, Th, Td, inr, Badge, EmptyState } from "@/components/ui";
import { buildBankFileData } from "@/lib/bank-file";

export default async function BankFilePage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ template?: string }> }) {
  const { runId } = await params;
  const { template } = await searchParams;
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) notFound();

  const { rows, issues, monthLabel } = await buildBankFileData(runId);
  const templates = await prisma.bankFileTemplate.findMany({ where: { isActive: true } });
  const activeTemplate = templates.find((t) => t.code === template) ?? templates[0];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Bank Salary Payment File"
        description={`${monthLabel} · Net payout total: ${inr(rows.reduce((s, r) => s + r.netSalary, 0))}`}
        actions={
          <>
            <form method="get" className="flex items-center gap-2">
              <select name="template" defaultValue={activeTemplate?.code} className="rounded-md border border-[var(--border)] px-2 py-1.5 text-sm">
                {templates.map((t) => <option key={t.code} value={t.code}>{t.bankName}</option>)}
              </select>
              <Button type="submit" variant="secondary">Switch Template</Button>
            </form>
            <Button href={`/api/payroll/${runId}/bank-file/export?format=xlsx&template=${activeTemplate?.code}`} variant="secondary">Export Excel</Button>
            <Button href={`/api/payroll/${runId}/bank-file/export?format=csv&template=${activeTemplate?.code}`} variant="secondary">Export CSV</Button>
          </>
        }
      />

      {issues.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <div className="mb-2 text-sm font-semibold text-red-700">Validation Issues ({issues.length})</div>
          <ul className="list-disc pl-5 text-sm text-red-700">
            {issues.map((issue, i) => (
              <li key={i}>{issue.employeeCode} - {issue.employeeName}: {issue.issue}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState message="No records for this run." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Bank</Th>
                <Th>Account Number</Th>
                <Th>IFSC</Th>
                <Th>Net Salary</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowIssues = issues.filter((i) => i.employeeCode === r.employeeCode);
                return (
                  <tr key={r.employeeCode}>
                    <Td>{r.employeeCode} - {r.employeeName}</Td>
                    <Td>{r.bankName || "-"}</Td>
                    <Td>{r.accountNumber || "-"}</Td>
                    <Td>{r.ifsc || "-"}</Td>
                    <Td>{inr(r.netSalary)}</Td>
                    <Td>{r.paymentReference}</Td>
                    <Td>{rowIssues.length > 0 ? <Badge tone="danger">Issue</Badge> : <Badge tone="success">OK</Badge>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
