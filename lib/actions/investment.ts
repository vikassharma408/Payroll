"use server";

import { prisma } from "@/lib/db";
import { investmentDeclarationSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function saveInvestmentDeclaration(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = investmentDeclarationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { employeeId, financialYearId, ...rest } = parsed.data;

  await prisma.investmentDeclaration.upsert({
    where: { employeeId_financialYearId: { employeeId, financialYearId } },
    update: { ...rest },
    create: { employeeId, financialYearId, ...rest },
  });

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}
