import { NextRequest } from "next/server";
import { getReportData, type ReportKey } from "@/lib/reports";
import { buildWorkbookFromRows, buildCsvFromRows } from "@/lib/import/excel";

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  const runId = req.nextUrl.searchParams.get("runId") ?? undefined;
  const financialYearId = req.nextUrl.searchParams.get("fyId") ?? undefined;

  const { columns, rows } = await getReportData(type as ReportKey, { runId, financialYearId });

  if (format === "csv") {
    const csv = buildCsvFromRows(columns, rows);
    return new Response(csv, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${type}.csv"` },
    });
  }

  const buffer = buildWorkbookFromRows(type, columns, rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${type}.xlsx"`,
    },
  });
}
