"use server";

import { prisma } from "@/lib/db";
import { resolveSalaryStructure, type ComponentDef } from "@/lib/formula-engine";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface StructureEntryInput {
  componentId: string;
  componentCode: string;
  isFormula: boolean;
  formula?: string;
  fixedAnnualAmount?: number;
}

export async function saveSalaryStructure(input: {
  employeeId: string;
  financialYearId: string;
  annualCTC: number;
  effectiveFrom: string;
  entries: StructureEntryInput[];
}): Promise<ActionResult> {
  try {
    const defs: ComponentDef[] = input.entries.map((e) => ({
      code: e.componentCode,
      formula: e.isFormula ? e.formula ?? null : null,
      fixedAnnualAmount: e.isFormula ? undefined : e.fixedAnnualAmount ?? 0,
    }));
    const resolved = resolveSalaryStructure(input.annualCTC, defs);

    await prisma.$transaction(async (tx) => {
      await tx.employeeSalaryStructure.updateMany({
        where: { employeeId: input.employeeId, financialYearId: input.financialYearId, isActive: true },
        data: { isActive: false, effectiveTo: new Date(input.effectiveFrom) },
      });
      const structure = await tx.employeeSalaryStructure.create({
        data: {
          employeeId: input.employeeId,
          financialYearId: input.financialYearId,
          annualCTC: input.annualCTC,
          effectiveFrom: new Date(input.effectiveFrom),
          isActive: true,
        },
      });
      for (const e of input.entries) {
        const r = resolved[e.componentCode];
        await tx.employeeSalaryComponentValue.create({
          data: {
            structureId: structure.id,
            componentId: e.componentId,
            monthlyAmount: r.monthlyAmount,
            annualAmount: r.annualAmount,
            formulaUsed: r.formulaTrace,
          },
        });
      }
    });

    revalidatePath(`/employees/${input.employeeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
