import { renderSalarySlipPdf } from "@/lib/pdf/salary-slip";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string; lineId: string }> }) {
  const { lineId } = await params;
  const buffer = await renderSalarySlipPdf(lineId);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${lineId}.pdf"`,
    },
  });
}
