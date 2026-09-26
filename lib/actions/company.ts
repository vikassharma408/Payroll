"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function saveCompany(formData: FormData): Promise<ActionResult> {
  const data = {
    name: String(formData.get("name") ?? ""),
    address: String(formData.get("address") ?? "") || null,
    pan: String(formData.get("pan") ?? "") || null,
    tan: String(formData.get("tan") ?? "") || null,
    bankName: String(formData.get("bankName") ?? "") || null,
    bankAccountNo: String(formData.get("bankAccountNo") ?? "") || null,
    bankIfsc: String(formData.get("bankIfsc") ?? "") || null,
  };
  if (!data.name.trim()) return { ok: false, error: "Company name is required" };

  const existing = await prisma.company.findFirst();
  if (existing) {
    await prisma.company.update({ where: { id: existing.id }, data });
  } else {
    await prisma.company.create({ data });
  }
  revalidatePath("/settings/company");
  return { ok: true };
}
