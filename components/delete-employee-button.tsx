"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { deleteEmployee, type ActionResult } from "@/lib/actions/employees";

export function DeleteEmployeeButton({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [state, formAction, pending] = useActionState(async () => deleteEmployee(employeeId), { ok: true } as ActionResult);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete ${employeeName}? This removes their profile, salary structure, investment declaration and previous employer records. This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Deleting..." : "Delete Employee"}
        </Button>
      </form>
      {state.error && <div className="max-w-sm text-right text-xs text-[var(--bad-text)]">{state.error}</div>}
    </div>
  );
}
