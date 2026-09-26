"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { uploadImportFile, type ImportActionResult } from "@/lib/actions/import";
import type { ImportTemplateType } from "@/lib/types";

type TemplateKey = ImportTemplateType | "COMBINED";

const COMBINED_TEMPLATE = {
  key: "COMBINED" as const,
  label: "Combined Setup Template (Recommended)",
  description: "Employee Master + Salary Structure + Investment Declaration + Previous Employer, all in one workbook, plus a step-by-step Instructions tab.",
};

const INDIVIDUAL_TEMPLATES: { key: ImportTemplateType; label: string; description: string }[] = [
  { key: "EMPLOYEE", label: "Employee Master only", description: "Bulk-create employees" },
  { key: "SALARY_STRUCTURE", label: "Salary Structure only", description: "Set annual component amounts for the current FY" },
  { key: "INVESTMENT", label: "Investment Declaration only", description: "Bulk-load Chapter VI-A declarations" },
  { key: "PREVIOUS_EMPLOYER", label: "Previous Employer only", description: "Mid-year joiner income from previous employer" },
  { key: "MONTHLY_PAYROLL", label: "Monthly Payroll Input", description: "LOP days and variable pay for an existing payroll run" },
];

const initial: ImportActionResult = { ok: true };

export function ImportWizard() {
  const [type, setType] = useState<TemplateKey>("COMBINED");
  const [showIndividual, setShowIndividual] = useState(false);
  const [state, formAction, pending] = useActionState(async (_: ImportActionResult, fd: FormData) => uploadImportFile(fd), initial);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-[var(--brand)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)]">
        <div className="text-sm">
          <strong>Only adding one employee?</strong> You don&apos;t need Excel at all — go to{" "}
          <Link href="/employees/new" className="text-[var(--brand)] hover:underline">Employees → + Add Employee</Link>{" "}
          and fill in their Salary Structure / Investment Declaration / Previous Employer directly on their page.
          Use the Import Wizard below only when loading many employees at once.
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">1. Choose a Template</div>

        <label
          className={`mb-2 flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${type === "COMBINED" ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)]" : "border-[var(--border)]"}`}
        >
          <input type="radio" name="templateTypeRadio" checked={type === "COMBINED"} onChange={() => setType("COMBINED")} className="mt-1" />
          <span>
            <span className="block font-medium">{COMBINED_TEMPLATE.label}</span>
            <span className="block text-xs text-[var(--muted)]">{COMBINED_TEMPLATE.description}</span>
          </span>
        </label>

        <button
          type="button"
          onClick={() => setShowIndividual((s) => !s)}
          className="mb-2 text-xs text-[var(--brand)] hover:underline"
        >
          {showIndividual ? "Hide individual templates" : "Or use an individual template instead..."}
        </button>

        {showIndividual && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {INDIVIDUAL_TEMPLATES.map((t) => (
              <label
                key={t.key}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${type === t.key ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)]" : "border-[var(--border)]"}`}
              >
                <input type="radio" name="templateTypeRadio" checked={type === t.key} onChange={() => setType(t.key)} className="mt-1" />
                <span>
                  <span className="block font-medium">{t.label}</span>
                  <span className="block text-xs text-[var(--muted)]">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}

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
        {state.error && <div className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--bad)_35%,transparent)] bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] px-3 py-2 text-sm text-[var(--bad-text)]">{state.error}</div>}
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
