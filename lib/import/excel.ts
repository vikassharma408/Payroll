import * as XLSX from "xlsx";
import type { ImportTemplateType } from "@/lib/types";
import { IMPORT_TEMPLATES, type ImportColumnSpec } from "./spec";
import { INSTRUCTIONS_LINES } from "./instructions";

/** Mandatory columns are marked with a trailing " *" in the generated file so users can see it at a glance. */
function displayHeader(c: ImportColumnSpec): string {
  return c.required ? `${c.header} *` : c.header;
}

function buildDataSheet(spec: { sheetName: string; columns: ImportColumnSpec[] }) {
  const headers = spec.columns.map(displayHeader);
  const exampleRow = spec.columns.map((c) => c.example ?? "");
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  return ws;
}

function buildFieldReferenceSheet(columns: ImportColumnSpec[]) {
  const notesWs = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Type", "Notes"],
    ...columns.map((c) => [
      c.header,
      c.required ? "Yes (marked with * in the data tab)" : "No",
      c.type === "enum" ? `One of: ${c.enumValues?.join(", ")}` : c.type,
      c.type === "boolean" ? "Y/N/Yes/No/True/False" : c.type === "date" ? "YYYY-MM-DD" : "",
    ]),
  ]);
  notesWs["!cols"] = [{ wch: 28 }, { wch: 30 }, { wch: 24 }, { wch: 30 }];
  return notesWs;
}

function buildInstructionsSheet() {
  const ws = XLSX.utils.aoa_to_sheet(INSTRUCTIONS_LINES.map((line) => [line]));
  ws["!cols"] = [{ wch: 110 }];
  return ws;
}

export function buildTemplateWorkbook(type: ImportTemplateType): Buffer {
  const spec = IMPORT_TEMPLATES[type];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildDataSheet(spec), spec.sheetName.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, buildFieldReferenceSheet(spec.columns), "Field Reference");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * One workbook combining the Employee Master, Salary Structure, Investment
 * Declaration and Previous Employer tabs (everything needed for initial
 * setup) plus an Instructions tab - the recommended path for loading many
 * employees at once. Monthly Payroll Input is deliberately NOT included
 * here: it's recurring per-month data, not one-time setup data.
 */
export function buildCombinedTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildInstructionsSheet(), "Instructions");
  for (const type of ["EMPLOYEE", "SALARY_STRUCTURE", "INVESTMENT", "PREVIOUS_EMPLOYER"] as const) {
    const spec = IMPORT_TEMPLATES[type];
    XLSX.utils.book_append_sheet(wb, buildDataSheet(spec), spec.sheetName.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Strips the " *" (or "*") mandatory-field marker back off a header so lookups by clean field name keep working regardless of whether the uploaded file still has it. */
function normalizeKey(key: string): string {
  return key.replace(/\s*\*\s*$/, "").trim();
}

export function parseWorkbookRows(buffer: Buffer, sheetName?: string): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false }) as Record<string, unknown>[];
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), v])));
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
