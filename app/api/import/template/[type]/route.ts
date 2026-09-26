import { buildTemplateWorkbook } from "@/lib/import/excel";
import { IMPORT_TEMPLATES } from "@/lib/import/spec";
import type { ImportTemplateType } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!(type in IMPORT_TEMPLATES)) {
    return new Response("Unknown template type", { status: 404 });
  }
  const buffer = buildTemplateWorkbook(type as ImportTemplateType);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${type.toLowerCase()}-template.xlsx"`,
    },
  });
}
