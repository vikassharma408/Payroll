"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, inputClass, inr } from "@/components/ui";
import { resolveSalaryStructure, type ComponentDef } from "@/lib/formula-engine";
import { saveSalaryStructure, type StructureEntryInput } from "@/lib/actions/salary-structure";

interface ComponentMeta {
  id: string;
  code: string;
  name: string;
  category: "EARNING" | "EMPLOYER_CONTRIBUTION" | "DEDUCTION";
}

interface RowState {
  included: boolean;
  isFormula: boolean;
  formula: string;
  fixedAnnualAmount: string;
}

export function SalaryStructureForm({
  employeeId,
  financialYearId,
  financialYearCode,
  components,
  existing,
  existingCTC,
}: {
  employeeId: string;
  financialYearId: string;
  financialYearCode: string;
  components: ComponentMeta[];
  existing: Record<string, { formula?: string; annualAmount: number }>;
  existingCTC: number;
}) {
  const [ctc, setCtc] = useState(String(existingCTC || 1200000));
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const c of components) {
      const ex = existing[c.code];
      initial[c.code] = {
        included: !!ex,
        isFormula: !!ex?.formula && /[A-Za-z%]/.test(ex.formula ?? ""),
        formula: ex?.formula && /[A-Za-z%]/.test(ex.formula) ? ex.formula : "",
        fixedAnnualAmount: ex ? String(ex.annualAmount) : "",
      };
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function updateRow(code: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  const preview = useMemo(() => {
    const defs: ComponentDef[] = components
      .filter((c) => rows[c.code]?.included)
      .map((c) => ({
        code: c.code,
        formula: rows[c.code].isFormula ? rows[c.code].formula : null,
        fixedAnnualAmount: rows[c.code].isFormula ? undefined : Number(rows[c.code].fixedAnnualAmount || 0),
      }));
    try {
      return { resolved: resolveSalaryStructure(Number(ctc) || 0, defs), error: null as string | null };
    } catch (err) {
      return { resolved: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [components, rows, ctc]);

  const grouped = {
    EARNING: components.filter((c) => c.category === "EARNING"),
    EMPLOYER_CONTRIBUTION: components.filter((c) => c.category === "EMPLOYER_CONTRIBUTION"),
    DEDUCTION: components.filter((c) => c.category === "DEDUCTION"),
  };

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const entries: StructureEntryInput[] = components
      .filter((c) => rows[c.code]?.included)
      .map((c) => ({
        componentId: c.id,
        componentCode: c.code,
        isFormula: rows[c.code].isFormula,
        formula: rows[c.code].formula,
        fixedAnnualAmount: Number(rows[c.code].fixedAnnualAmount || 0),
      }));
    const result = await saveSalaryStructure({ employeeId, financialYearId, annualCTC: Number(ctc) || 0, effectiveFrom, entries });
    setSaving(false);
    setMessage(result.ok ? "Salary structure saved." : `Error: ${result.error}`);
  }

  function renderGroup(title: string, list: ComponentMeta[]) {
    return (
      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</div>
        <div className="flex flex-col gap-2">
          {list.map((c) => {
            const row = rows[c.code];
            const resolvedAmt = preview.resolved?.[c.code];
            return (
              <div key={c.code} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] p-2">
                <label className="flex w-44 items-center gap-2 text-sm">
                  <input type="checkbox" checked={row.included} onChange={(e) => updateRow(c.code, { included: e.target.checked })} />
                  {c.name}
                </label>
                {row.included && (
                  <>
                    <select
                      className={inputClass}
                      value={row.isFormula ? "formula" : "fixed"}
                      onChange={(e) => updateRow(c.code, { isFormula: e.target.value === "formula" })}
                    >
                      <option value="fixed">Fixed Amount (annual)</option>
                      <option value="formula">Formula</option>
                    </select>
                    {row.isFormula ? (
                      <input
                        className={`${inputClass} w-64`}
                        placeholder="e.g. 40% of CTC, or 50% of BASIC"
                        value={row.formula}
                        onChange={(e) => updateRow(c.code, { formula: e.target.value })}
                      />
                    ) : (
                      <input
                        type="number"
                        className={`${inputClass} w-40`}
                        placeholder="Annual amount"
                        value={row.fixedAnnualAmount}
                        onChange={(e) => updateRow(c.code, { fixedAnnualAmount: e.target.value })}
                      />
                    )}
                    <span className="text-xs text-[var(--muted)]">
                      {resolvedAmt ? `= ${inr(resolvedAmt.annualAmount)}/yr (${inr(resolvedAmt.monthlyAmount)}/mo)` : ""}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Salary Structure - FY {financialYearCode}</div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Annual CTC (Rs)">
          <input type="number" className={inputClass} value={ctc} onChange={(e) => setCtc(e.target.value)} />
        </Field>
        <Field label="Effective From">
          <input type="date" className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </div>

      {renderGroup("Earnings", grouped.EARNING)}
      {renderGroup("Employer Contributions", grouped.EMPLOYER_CONTRIBUTION)}
      {renderGroup("Deductions", grouped.DEDUCTION)}

      {preview.error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{preview.error}</div>}
      {message && <div className="mb-3 rounded-md border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm">{message}</div>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Salary Structure"}
      </Button>
    </Card>
  );
}
