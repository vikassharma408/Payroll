"use server";

import { prisma } from "@/lib/db";
import { processPayrollRun } from "@/lib/payroll/engine";
import { advancePayrollStatus, addAdjustment } from "@/lib/payroll/workflow";
import { payrollRunCreateSchema, adjustmentSchema } from "@/lib/validation";
import { fyMonthIndexToCalendar } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createPayrollRun(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = payrollRunCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const { financialYearId, payrollMonthIndex, payrollGroup } = parsed.data;

  const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: financialYearId } });
  const { calendarYear, calendarMonth } = fyMonthIndexToCalendar(payrollMonthIndex, fy.startDate.getFullYear());

  const existing = await prisma.payrollRun.findFirst({
    where: { financialYearId, payrollMonthIndex, payrollGroup: payrollGroup || null },
  });
  if (existing) redirect(`/payroll/${existing.id}`);

  const run = await prisma.payrollRun.create({
    data: {
      financialYearId,
      payrollMonthIndex,
      calendarYear,
      calendarMonth,
      payrollGroup: payrollGroup || null,
      status: "DRAFT",
      createdBy: "Payroll Admin",
    },
  });

  revalidatePath("/payroll");
  redirect(`/payroll/${run.id}`);
}

export async function runPayrollCalculation(runId: string): Promise<ActionResult> {
  try {
    const result = await processPayrollRun(runId);
    revalidatePath(`/payroll/${runId}`);
    if (result.skipped.length > 0) {
      return { ok: true, error: `Processed ${result.processed}. Skipped: ${result.skipped.map((s) => `${s.employeeCode} (${s.reason})`).join("; ")}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function changePayrollStatus(runId: string, status: string): Promise<ActionResult> {
  try {
    await advancePayrollStatus(runId, status as never);
    revalidatePath(`/payroll/${runId}`);
    revalidatePath("/payroll");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitAdjustment(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = adjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  try {
    const adj = await addAdjustment(parsed.data);
    const line = await prisma.payrollRunLine.findUniqueOrThrow({ where: { id: adj.payrollRunLineId } });
    revalidatePath(`/payroll/${line.payrollRunId}/lines/${line.id}`);
    revalidatePath(`/payroll/${line.payrollRunId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
