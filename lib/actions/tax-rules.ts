"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : Number(v));

export async function updateTaxRuleSet(ruleSetId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { id: ruleSetId }, include: { slabs: true } });

    await prisma.taxRuleSet.update({
      where: { id: ruleSetId },
      data: {
        standardDeduction: num(formData.get("standardDeduction")) ?? ruleSet.standardDeduction,
        cessRate: (num(formData.get("cessRatePercent")) ?? ruleSet.cessRate * 100) / 100,
        rebateLimitOld: num(formData.get("rebateLimitOld")) ?? ruleSet.rebateLimitOld,
        rebateMaxOld: num(formData.get("rebateMaxOld")) ?? ruleSet.rebateMaxOld,
        rebateLimitNew: num(formData.get("rebateLimitNew")) ?? ruleSet.rebateLimitNew,
        npsEmployerCapPercent: (num(formData.get("npsEmployerCapPercentPercent")) ?? ruleSet.npsEmployerCapPercent * 100) / 100,
        employerNpsPfPerqLimit: num(formData.get("employerNpsPfPerqLimit")) ?? ruleSet.employerNpsPfPerqLimit,
        notes: (formData.get("notes") as string) || null,
      },
    });

    for (const slab of ruleSet.slabs) {
      const min = num(formData.get(`slab_${slab.id}_min`));
      const maxRaw = formData.get(`slab_${slab.id}_max`);
      const ratePercent = num(formData.get(`slab_${slab.id}_rate`));
      await prisma.taxSlab.update({
        where: { id: slab.id },
        data: {
          minIncome: min ?? slab.minIncome,
          maxIncome: maxRaw === "" || maxRaw === null ? null : Number(maxRaw),
          rate: ratePercent !== undefined ? ratePercent / 100 : slab.rate,
        },
      });
    }

    revalidatePath("/tax-rules");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setCurrentFinancialYear(financialYearId: string): Promise<ActionResult> {
  await prisma.$transaction([
    prisma.financialYear.updateMany({ data: { isCurrent: false }, where: {} }),
    prisma.financialYear.update({ where: { id: financialYearId }, data: { isCurrent: true } }),
  ]);
  revalidatePath("/tax-rules");
  revalidatePath("/dashboard");
  return { ok: true };
}
