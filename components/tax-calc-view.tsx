"use client";

import { useState } from "react";
import { inr } from "@/components/ui";
import type { TaxCalcResult } from "@/lib/tax-engine/calculate";

export function TaxCalcView({ result, label }: { result: TaxCalcResult; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-[var(--ink-2)]"
      >
        <span>View Calculation - {label}</span>
        <span className="text-[var(--muted)]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          {result.warnings.length > 0 && (
            <div className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--clay)_45%,transparent)] bg-[color-mix(in_srgb,var(--clay)_12%,transparent)] px-2 py-1.5 text-xs text-[var(--clay)]">
              {result.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
          <table className="w-full text-xs">
            <tbody>
              {result.steps.map((s, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  <td className="py-1 pr-2">{s.label}{s.note && <div className="text-[var(--muted)]">{s.note}</div>}</td>
                  <td className="py-1 text-right font-mono">{s.amount !== undefined ? inr(s.amount) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
