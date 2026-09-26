import * as XLSX from "xlsx";
import type { ImportTemplateType } from "@/lib/types";
import { IMPORT_TEMPLATES } from "./spec";

export function buildTemplateWorkbook(type: ImportTemplateType): Buffer {
  const spec = IMPORT_TEMPLATES[type];
  const headers = spec.columns.map((c) => c.header);
  const exampleRow = spec.columns.map((c) => c.example ?? "");
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName.slice(0, 31));

  const notesWs = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Type", "Notes"],
    ...spec.columns.map((c) => [
      c.header,
      c.required ? "Yes" : "No",
      c.type === "enum" ? `One of: ${c.enumValues?.join(", ")}` : c.type,
      c.type === "boolean" ? "Y/N/Yes/No/True/False" : c.type === "date" ? "YYYY-MM-DD" : "",
    ]),
  ]);
  notesWs["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, notesWs, "Instructions");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function parseWorkbookRows(buffer: Buffer, sheetName?: string): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

export function buildWorkbookFromRows(sheetName: string, headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildCsvFromRows(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}
