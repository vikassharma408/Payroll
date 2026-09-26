"use server";

import { prisma } from "@/lib/db";
import { previousEmployerSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function savePreviousEmployerIncome(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = previousEmployerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { employeeId, financialYearId, periodFrom, periodTo, ...rest } = parsed.data;

  await prisma.previousEmployerIncome.create({
    data: {
      employeeId,
      financialYearId,
      periodFrom: new Date(periodFrom),
      periodTo: new Date(periodTo),
      ...rest,
    },
  });

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

export async function deletePreviousEmployerIncome(id: string, employeeId: string): Promise<ActionResult> {
  await prisma.previousEmployerIncome.delete({ where: { id } });
  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}
