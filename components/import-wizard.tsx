"use client";

import { useActionState, useState } from "react";
import { Card, Button, Badge } from "@/components/ui";
import { uploadImportFile, type ImportActionResult } from "@/lib/actions/import";
import type { ImportTemplateType } from "@/lib/types";

const TEMPLATES: { key: ImportTemplateType; label: string; description: string }[] = [
  { key: "EMPLOYEE", label: "Employee Master", description: "Bulk-create employees" },
  { key: "SALARY_STRUCTURE", label: "Salary Structure", description: "Set annual component amounts for the current FY" },
  { key: "INVESTMENT", label: "Investment Declaration", description: "Bulk-load Chapter VI-A declarations" },
  { key: "PREVIOUS_EMPLOYER", label: "Previous Employer", description: "Mid-year joiner income from previous employer" },
  { key: "MONTHLY_PAYROLL", label: "Monthly Payroll Input", description: "LOP days and variable pay for an existing payroll run" },
];

const initial: ImportActionResult = { ok: true };

export function ImportWizard() {
  const [type, setType] = useState<ImportTemplateType>("EMPLOYEE");
  const [state, formAction, pending] = useActionState(async (_: ImportActionResult, fd: FormData) => uploadImportFile(fd), initial);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3 text-sm font-semibold">1. Choose a Template</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {TEMPLATES.map((t) => (
            <label
              key={t.key}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${type === t.key ? "border-[var(--brand)] bg-blue-50" : "border-[var(--border)]"}`}
            >
              <input type="radio" name="templateTypeRadio" checked={type === t.key} onChange={() => setType(t.key)} className="mt-1" />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs text-[var(--muted)]">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <Button href={`/api/import/template/${type}`} variant="secondary">Download Template</Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">2. Upload Completed File</div>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="templateType" value={type} />
          <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
          <Button type="submit" disabled={pending}>{pending ? "Validating & Importing..." : "Upload & Import"}</Button>
        </form>
        {state.error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      </Card>

      {state.summary && (
        <Card>
          <div className="mb-3 text-sm font-semibold">Import Summary</div>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <div>Records found: <strong>{state.summary.totalRecords}</strong></div>
            <div>Imported: <Badge tone="success">{state.summary.importedRecords}</Badge></div>
            <div>Failed: <Badge tone={state.summary.failedRecords > 0 ? "danger" : "default"}>{state.summary.failedRecords}</Badge></div>
          </div>
          {state.summary.errors.length > 0 && (
            <>
              <table className="mb-3">
                <thead><tr><th className="pb-1 text-left text-xs text-[var(--muted)]">Row</th><th className="pb-1 text-left text-xs text-[var(--muted)]">Error</th></tr></thead>
                <tbody>
                  {state.summary.errors.map((e, i) => (
                    <tr key={i} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-4 text-sm">{e.rowNumber}</td>
                      <td className="py-1 text-sm">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button href={`/api/import/errors/${state.summary.batchId}`} variant="secondary">Download Error Report</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
