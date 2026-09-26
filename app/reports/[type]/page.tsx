import { prisma } from "@/lib/db";
import { PageHeader, Card, Button, Th, Td, EmptyState } from "@/components/ui";
import { getReportData, REPORT_TYPES, type ReportKey } from "@/lib/reports";
import { FY_MONTH_NAMES } from "@/lib/types";

export default async function ReportViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ runId?: string; fyId?: string }>;
}) {
  const { type } = await params;
  const { runId, fyId } = await searchParams;
  const meta = REPORT_TYPES.find((r) => r.key === type);

  const runs = await prisma.payrollRun.findMany({ include: { financialYear: true }, orderBy: [{ financialYearId: "desc" }, { payrollMonthIndex: "desc" }] });
  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "desc" } });

  let columns: string[] = [];
  let rows: (string | number)[][] = [];
  let errorMsg: string | null = null;
  try {
    if (meta?.needsRun && !runId) errorMsg = "Select a payroll run.";
    else if (!meta?.needsRun && meta && "needsFy" in meta && meta.needsFy && !fyId) errorMsg = "Select a financial year.";
    else {
      const result = await getReportData(type as ReportKey, { runId, financialYearId: fyId });
      columns = result.columns;
      rows = result.rows;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={meta?.label ?? type}
        actions={
          <>
            <Button href={`/api/reports/${type}/export?format=xlsx${runId ? `&runId=${runId}` : ""}${fyId ? `&fyId=${fyId}` : ""}`} variant="secondary">Export Excel</Button>
            <Button href={`/api/reports/${type}/export?format=csv${runId ? `&runId=${runId}` : ""}${fyId ? `&fyId=${fyId}` : ""}`} variant="secondary">Export CSV</Button>
          </>
        }
      />

      <Card>
        <form className="flex flex-wrap items-end gap-3" method="get">
          {meta?.needsRun && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--muted)]">Payroll Run</label>
              <select name="runId" defaultValue={runId} className="rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2 py-1.5 text-sm text-[var(--ivory)]">
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{FY_MONTH_NAMES[r.payrollMonthIndex - 1]} {r.calendarYear} (FY {r.financialYear.code})</option>
                ))}
              </select>
            </div>
          )}
          {!meta?.needsRun && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--muted)]">Financial Year</label>
              <select name="fyId" defaultValue={fyId} className="rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2 py-1.5 text-sm text-[var(--ivory)]">
                {financialYears.map((f) => <option key={f.id} value={f.id}>FY {f.code}</option>)}
              </select>
            </div>
          )}
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </Card>

      <Card className="overflow-x-auto">
        {errorMsg ? (
          <EmptyState message={errorMsg} />
        ) : rows.length === 0 ? (
          <EmptyState message="No data available." />
        ) : (
          <table>
            <thead>
              <tr>{columns.map((c) => <Th key={c}>{c}</Th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <Td key={j}>{typeof cell === "number" ? cell.toLocaleString("en-IN") : String(cell)}</Td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
