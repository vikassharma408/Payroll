"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { emailSalarySlip } from "@/lib/actions/slip";

export function EmailSlipButton({ lineId }: { lineId: string }) {
  const [state, action, pending] = useActionState(async () => emailSalarySlip(lineId), { ok: true });
  return (
    <div className="flex flex-col items-start gap-1">
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Sending..." : "Email Salary Slip"}
        </Button>
      </form>
      {state.error && <div className="max-w-md text-xs text-[var(--clay)]">{state.error}</div>}
    </div>
  );
}
