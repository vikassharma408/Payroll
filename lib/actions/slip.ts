"use server";

import { prisma } from "@/lib/db";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Records an email-slip request. Actually dispatching the email requires an
 * SMTP/email-provider integration and credentials this environment does not
 * have configured - wire up a provider (e.g. via SMTP or a transactional
 * email API) here and this action will start sending for real. Until then it
 * logs the request so the workflow and audit trail are still exercised.
 */
export async function emailSalarySlip(lineId: string): Promise<ActionResult> {
  const line = await prisma.payrollRunLine.findUnique({ where: { id: lineId }, include: { employee: true } });
  if (!line) return { ok: false, error: "Payslip not found" };
  if (!line.employee.email) return { ok: false, error: "This employee has no email address on file." };

  await prisma.auditLog.create({
    data: {
      entityType: "PayrollRunLine",
      entityId: lineId,
      action: "EMAIL_SLIP_REQUESTED",
      performedBy: "Payroll Admin",
      detail: JSON.stringify({ to: line.employee.email }),
    },
  });

  return {
    ok: false,
    error: `Email delivery is not configured in this environment (no SMTP/email provider set up). The request to email ${line.employee.email} was logged in the audit trail; connect an email provider to lib/actions/slip.ts to enable real delivery.`,
  };
}
