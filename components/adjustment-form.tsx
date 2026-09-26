"use client";

import { useActionState } from "react";
import { Field, inputClass, Button } from "@/components/ui";
import { submitAdjustment } from "@/lib/actions/payroll";

export function AdjustmentForm({ payrollRunLineId }: { payrollRunLineId: string }) {
  const [state, formAction, pending] = useActionState(async (_: { ok: boolean; error?: string }, fd: FormData) => submitAdjustment(fd), { ok: true });

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="payrollRunLineId" value={payrollRunLineId} />
      <Field label="Amount (Rs)" hint="Positive = extra earning, negative = deduction">
        <input type="number" step="0.01" name="amount" required className={inputClass} />
      </Field>
      <Field label="Reason *">
        <input name="reason" required className={`${inputClass} w-64`} />
      </Field>
      <Field label="Entered By *">
        <input name="enteredBy" required defaultValue="Payroll Admin" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Add Adjustment"}</Button>
      {state.error && <div className="w-full text-xs text-[var(--bad-text)]">{state.error}</div>}
    </form>
  );
}
