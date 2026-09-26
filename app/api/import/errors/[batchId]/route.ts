import { prisma } from "@/lib/db";
import { buildCsvFromRows } from "@/lib/import/excel";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { errors: true } });
  if (!batch) return new Response("Not found", { status: 404 });

  const csv = buildCsvFromRows(
    ["Row", "Error"],
    batch.errors.map((e) => [e.rowNumber, e.message]),
  );
  return new Response(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="import-errors-${batchId}.csv"` },
  });
}
