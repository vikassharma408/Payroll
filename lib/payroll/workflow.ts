import { prisma } from "@/lib/db";
import { PAYROLL_STATUS_ORDER, type PayrollStatus } from "@/lib/types";

const TIMESTAMP_FIELD: Partial<Record<PayrollStatus, string>> = {
  REVIEWED: "reviewedAt",
  APPROVED: "approvedAt",
  LOCKED: "lockedAt",
  PAID: "paidAt",
};

/**
 * Enforces the Draft -> Calculated -> Reviewed -> Approved -> Locked -> Paid
 * sequence. Once Locked, the run's lines are frozen; any further change must
 * go through addAdjustment (a separate audited entry), never a raw edit.
 */
export async function advancePayrollStatus(runId: string, targetStatus: PayrollStatus) {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const currentIndex = PAYROLL_STATUS_ORDER.indexOf(run.status as PayrollStatus);
  const targetIndex = PAYROLL_STATUS_ORDER.indexOf(targetStatus);
  if (targetIndex !== currentIndex + 1) {
    throw new Error(
      `Cannot move payroll run from ${run.status} to ${targetStatus}. Status must advance one step at a time: ${PAYROLL_STATUS_ORDER.join(" -> ")}.`,
    );
  }
  const data: Record<string, unknown> = { status: targetStatus };
  const field = TIMESTAMP_FIELD[targetStatus];
  if (field) data[field] = new Date();
  return prisma.payrollRun.update({ where: { id: runId }, data });
}

export interface AddAdjustmentInput {
  payrollRunLineId: string;
  amount: number;
  reason: string;
  enteredBy: string;
}

/** Records an approved manual adjustment and re-derives net salary. Always audited; never silently edits the original calculation. */
export async function addAdjustment(input: AddAdjustmentInput) {
  if (!input.reason.trim()) throw new Error("A reason is required for every manual adjustment.");
  if (!input.enteredBy.trim()) throw new Error("Adjustments must record who entered them.");

  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.payrollAdjustment.create({ data: input });
    const line = await tx.payrollRunLine.findUniqueOrThrow({ where: { id: input.payrollRunLineId } });
    const updatedNet = line.netSalary + input.amount;
    await tx.payrollRunLine.update({ where: { id: line.id }, data: { netSalary: updatedNet } });
    return adjustment;
  });
}
