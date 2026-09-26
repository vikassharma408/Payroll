import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { buildBankFileData } from "@/lib/bank-file";
import { buildWorkbookFromRows, buildCsvFromRows } from "@/lib/import/excel";

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  const templateCode = req.nextUrl.searchParams.get("template");

  const { rows } = await buildBankFileData(runId);
  const template = templateCode
    ? await prisma.bankFileTemplate.findUnique({ where: { code: templateCode } })
    : await prisma.bankFileTemplate.findFirst({ where: { isActive: true } });

  const columns = template ? (JSON.parse(template.columns) as { header: string; field: string }[]) : [
    { header: "Employee Code", field: "employeeCode" },
    { header: "Employee Name", field: "employeeName" },
    { header: "Account Number", field: "accountNumber" },
    { header: "IFSC", field: "ifsc" },
    { header: "Net Salary", field: "netSalary" },
  ];

  const headers = columns.map((c) => c.header);
  const dataRows = rows.map((r) => columns.map((c) => (r as unknown as Record<string, string | number>)[c.field] ?? ""));

  if (format === "csv") {
    const csv = buildCsvFromRows(headers, dataRows);
    return new Response(csv, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="bank-file-${runId}.csv"` },
    });
  }

  const buffer = buildWorkbookFromRows("Bank Payment", headers, dataRows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bank-file-${runId}.xlsx"`,
    },
  });
}
