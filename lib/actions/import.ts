"use server";

import { runImport, type ImportSummary } from "@/lib/import/run-import";
import type { ImportTemplateType } from "@/lib/types";
import { revalidatePath } from "next/cache";

export interface ImportActionResult {
  ok: boolean;
  error?: string;
  summary?: ImportSummary;
}

export async function uploadImportFile(formData: FormData): Promise<ImportActionResult> {
  const type = formData.get("templateType") as ImportTemplateType | null;
  const file = formData.get("file") as File | null;
  if (!type) return { ok: false, error: "Template type is required" };
  if (!file || file.size === 0) return { ok: false, error: "Please choose a file to upload" };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await runImport(type, buffer, file.name);
    revalidatePath("/employees");
    revalidatePath("/import");
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
