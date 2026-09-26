import { prisma } from "@/lib/db";
import { PageHeader, Card, Badge, Th, Td, inr, EmptyState } from "@/components/ui";
import { compareRuns } from "@/lib/reports/reconciliation";
import { FY_MONTH_NAMES } from "@/lib/types";

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ currentRunId?: string; previousRunId?: string }> }) {
  const runs = await prisma.payrollRun.findMany({
    include: { financialYear: true },
    orderBy: [{ financialYearId: "desc" }, { payrollMonthIndex: "desc" }],
  });
  const { currentRunId, previousRunId } = await searchParams;
  const currentRun = currentRunId ? runs.find((r) => r.id === currentRunId) : runs[0];
  const previousRun = previousRunId
    ? runs.find((r) => r.id === previousRunId)
    : runs.find((r) => currentRun && r.financialYearId === currentRun.financialYearId && r.payrollMonthIndex === currentRun.payrollMonthIndex - 1);

  const comparison = currentRun ? await compareRuns(currentRun.id, previousRun?.id ?? null) : null;

  function runLabel(r: (typeof runs)[number]) {
    return `${FY_MONTH_NAMES[r.payrollMonthIndex - 1]} ${r.calendarYear} (FY ${r.financialYear.code})`;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payroll Reconciliation" description="Compare current month vs previous month and flag significant changes" />

      <Card>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted)]">Current Run</label>
            <select name="currentRunId" defaultValue={currentRun?.id} className="rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2 py-1.5 text-sm text-[var(--ivory)]">
              {runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--muted)]">Compare Against</label>
            <select name="previousRunId" defaultValue={previousRun?.id ?? ""} className="rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2 py-1.5 text-sm text-[var(--ivory)]">
              <option value="">(none)</option>
              {runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-sm text-[var(--on-accent)]">Compare</button>
        </form>
      </Card>

      {comparison && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card><div className="text-xs text-[var(--muted)]">Employees (Current/Prev)</div><div className="text-lg font-semibold">{comparison.summary.currentEmployeeCount} / {comparison.summary.previousEmployeeCount}</div></Card>
            <Card><div className="text-xs text-[var(--muted)]">New Joiners</div><div className="text-lg font-semibold">{comparison.summary.newJoiners}</div></Card>
            <Card><div className="text-xs text-[var(--muted)]">Leavers</div><div className="text-lg font-semibold">{comparison.summary.leavers}</div></Card>
            <Card><div className="text-xs text-[var(--muted)]">Flagged Changes</div><div className="text-lg font-semibold">{comparison.flaggedRows.length}</div></Card>
          </div>

          <Card>
            <div className="mb-3 text-sm font-semibold">Flagged Changes (&gt;10% or &gt; Rs 10,000)</div>
            {comparison.flaggedRows.length === 0 ? (
              <EmptyState message="No significant changes detected." />
            ) : (
              <table>
                <thead><tr><Th>Employee</Th><Th>Metric</Th><Th>Previous</Th><Th>Current</Th><Th>Change</Th></tr></thead>
                <tbody>
                  {comparison.flaggedRows.map((r, i) => (
                    <tr key={i}>
                      <Td>{r.employeeCode} - {r.employeeName}</Td>
                      <Td>{r.metric}</Td>
                      <Td>{inr(r.previous)}</Td>
                      <Td>{inr(r.current)}</Td>
                      <Td>
                        <Badge tone={r.change >= 0 ? "warning" : "danger"}>
                          {r.change >= 0 ? "+" : ""}{inr(r.change)} {r.changePercent !== null ? `(${r.changePercent.toFixed(1)}%)` : ""}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <div className="mb-3 text-sm font-semibold">Overall Movement</div>
            <table>
              <thead><tr><Th>Metric</Th><Th>Previous</Th><Th>Current</Th><Th>Change</Th></tr></thead>
              <tbody>
                <tr><Td>Gross Salary</Td><Td>{inr(comparison.summary.previousGross)}</Td><Td>{inr(comparison.summary.currentGross)}</Td><Td>{inr(comparison.summary.currentGross - comparison.summary.previousGross)}</Td></tr>
                <tr><Td>Net Salary</Td><Td>{inr(comparison.summary.previousNet)}</Td><Td>{inr(comparison.summary.currentNet)}</Td><Td>{inr(comparison.summary.currentNet - comparison.summary.previousNet)}</Td></tr>
                <tr><Td>TDS</Td><Td>{inr(comparison.summary.previousTds)}</Td><Td>{inr(comparison.summary.currentTds)}</Td><Td>{inr(comparison.summary.currentTds - comparison.summary.previousTds)}</Td></tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
