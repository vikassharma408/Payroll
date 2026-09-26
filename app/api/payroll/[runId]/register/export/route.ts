import { NextRequest } from "next/server";
import { getSalaryRegisterRows, SALARY_REGISTER_COLUMNS } from "@/lib/reports/salary-register";
import { buildWorkbookFromRows, buildCsvFromRows } from "@/lib/import/excel";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  const rows = await getSalaryRegisterRows(runId);
  const headers = SALARY_REGISTER_COLUMNS.map((c) => c.header);
  const dataRows = rows.map((r) => SALARY_REGISTER_COLUMNS.map((c) => r[c.field]));

  if (format === "csv") {
    const csv = buildCsvFromRows(headers, dataRows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="salary-register-${runId}.csv"`,
      },
    });
  }

  const buffer = buildWorkbookFromRows("Salary Register", headers, dataRows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="salary-register-${runId}.xlsx"`,
    },
  });
}
