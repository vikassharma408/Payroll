"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui";
import { runPayrollCalculation, changePayrollStatus } from "@/lib/actions/payroll";
import { PAYROLL_STATUS_ORDER, type PayrollStatus } from "@/lib/types";

const NEXT_STATUS_LABEL: Partial<Record<PayrollStatus, string>> = {
  DRAFT: "Mark Reviewed",
  CALCULATED: "Mark Reviewed",
  REVIEWED: "Approve",
  APPROVED: "Lock Payroll",
  LOCKED: "Mark Paid",
};

export function PayrollRunActions({ runId, status }: { runId: string; status: PayrollStatus }) {
  const [pending, startTransition] = useTransition();
  const [calcState, calcAction] = useActionState(async () => runPayrollCalculation(runId), { ok: true });
  const [statusState, setStatusState] = useActionState(async (_: { ok: boolean; error?: string }, next: PayrollStatus) => changePayrollStatus(runId, next), { ok: true });

  const currentIndex = PAYROLL_STATUS_ORDER.indexOf(status);
  const nextStatus = PAYROLL_STATUS_ORDER[currentIndex + 1];
  const canRecalculate = status !== "LOCKED" && status !== "PAID";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canRecalculate && (
          <form action={calcAction}>
            <Button type="submit">{status === "DRAFT" ? "Run Payroll Calculation" : "Recalculate"}</Button>
          </form>
        )}
        {nextStatus && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => startTransition(() => setStatusState(nextStatus))}
          >
            {NEXT_STATUS_LABEL[status] ?? `Move to ${nextStatus}`}
          </Button>
        )}
      </div>
      {calcState.error && <div className="text-xs text-amber-700">{calcState.error}</div>}
      {statusState.error && <div className="text-xs text-red-700">{statusState.error}</div>}
    </div>
  );
}
