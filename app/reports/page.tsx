import { prisma } from "@/lib/db";
import { PageHeader, Card, Button } from "@/components/ui";
import { REPORT_TYPES } from "@/lib/reports";
import { FY_MONTH_NAMES } from "@/lib/types";

export default async function ReportsIndexPage() {
  const runs = await prisma.payrollRun.findMany({
    include: { financialYear: true },
    orderBy: [{ financialYearId: "desc" }, { payrollMonthIndex: "desc" }],
    take: 12,
  });
  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "desc" } });
  const latestRun = runs[0];
  const currentFy = financialYears.find((f) => f.isCurrent) ?? financialYears[0];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="Select a report. Run-based reports use the most recent payroll run by default." />
      <Card>
        <table className="w-full">
          <tbody>
            {REPORT_TYPES.map((r) => (
              <tr key={r.key} className="border-b border-[var(--border)]">
                <td className="py-2 text-sm font-medium">{r.label}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="ghost"
                    href={
                      r.needsRun
                        ? `/reports/${r.key}?runId=${latestRun?.id ?? ""}`
                        : `/reports/${r.key}?fyId=${currentFy?.id ?? ""}`
                    }
                  >
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="mb-2 text-sm font-semibold">Available Payroll Runs</div>
        <div className="flex flex-wrap gap-2 text-xs">
          {runs.map((r) => (
            <span key={r.id} className="rounded-md border border-[var(--border)] px-2 py-1">
              {FY_MONTH_NAMES[r.payrollMonthIndex - 1]} {r.calendarYear} (FY {r.financialYear.code})
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
