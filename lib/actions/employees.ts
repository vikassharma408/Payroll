"use server";

import { prisma } from "@/lib/db";
import { employeeSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toDate(v?: string | null) {
  return v ? new Date(v) : null;
}

export async function createEmployee(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = employeeSchema.safeParse({
    ...raw,
    pfApplicable: formData.get("pfApplicable") === "on",
    esiApplicable: formData.get("esiApplicable") === "on",
    ptApplicable: formData.get("ptApplicable") === "on",
    isMetroCity: formData.get("isMetroCity") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const data = parsed.data;

  const existingCode = await prisma.employee.findUnique({ where: { employeeCode: data.employeeCode } });
  if (existingCode) return { ok: false, error: `Employee code '${data.employeeCode}' already exists.` };
  if (data.pan) {
    const existingPan = await prisma.employee.findFirst({ where: { pan: data.pan } });
    if (existingPan) return { ok: false, error: `PAN '${data.pan}' is already used by another employee.` };
  }

  const employee = await prisma.employee.create({
    data: {
      employeeCode: data.employeeCode,
      fullName: data.fullName,
      dob: toDate(data.dob),
      gender: data.gender || null,
      pan: data.pan || null,
      email: data.email || null,
      phone: data.phone || null,
      dateOfJoining: toDate(data.dateOfJoining)!,
      dateOfLeaving: toDate(data.dateOfLeaving),
      department: data.department || null,
      designation: data.designation || null,
      location: data.location || null,
      payrollGroup: data.payrollGroup || null,
      uan: data.uan || null,
      pfApplicable: data.pfApplicable,
      esiApplicable: data.esiApplicable,
      ptApplicable: data.ptApplicable,
      taxRegime: data.taxRegime,
      status: data.status,
      isMetroCity: data.isMetroCity,
      bankName: data.bankName || null,
      bankAccountNo: data.bankAccountNo || null,
      bankIfsc: data.bankIfsc || null,
    },
  });

  revalidatePath("/employees");
  redirect(`/employees/${employee.id}`);
}

export async function updateEmployee(employeeId: string, formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = employeeSchema.safeParse({
    ...raw,
    pfApplicable: formData.get("pfApplicable") === "on",
    esiApplicable: formData.get("esiApplicable") === "on",
    ptApplicable: formData.get("ptApplicable") === "on",
    isMetroCity: formData.get("isMetroCity") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const data = parsed.data;

  const dup = await prisma.employee.findFirst({ where: { employeeCode: data.employeeCode, NOT: { id: employeeId } } });
  if (dup) return { ok: false, error: `Employee code '${data.employeeCode}' already exists.` };

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      employeeCode: data.employeeCode,
      fullName: data.fullName,
      dob: toDate(data.dob),
      gender: data.gender || null,
      pan: data.pan || null,
      email: data.email || null,
      phone: data.phone || null,
      dateOfJoining: toDate(data.dateOfJoining)!,
      dateOfLeaving: toDate(data.dateOfLeaving),
      department: data.department || null,
      designation: data.designation || null,
      location: data.location || null,
      payrollGroup: data.payrollGroup || null,
      uan: data.uan || null,
      pfApplicable: data.pfApplicable,
      esiApplicable: data.esiApplicable,
      ptApplicable: data.ptApplicable,
      taxRegime: data.taxRegime,
      status: data.status,
      isMetroCity: data.isMetroCity,
      bankName: data.bankName || null,
      bankAccountNo: data.bankAccountNo || null,
      bankIfsc: data.bankIfsc || null,
    },
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}

export async function deleteEmployee(employeeId: string): Promise<ActionResult> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { ok: false, error: "Employee not found." };

  const processedLine = await prisma.payrollRunLine.findFirst({
    where: { employeeId },
    include: { payrollRun: { include: { financialYear: true } } },
    orderBy: { payrollRun: { payrollMonthIndex: "asc" } },
  });
  if (processedLine) {
    const { payrollRun } = processedLine;
    return {
      ok: false,
      error: `Cannot delete ${employee.fullName} (${employee.employeeCode}): payroll has already been processed for them (FY ${payrollRun.financialYear.code}, month ${payrollRun.payrollMonthIndex}, status ${payrollRun.status}). Payroll history must be preserved. Set their status to Inactive or Left instead of deleting them.`,
    };
  }

  await prisma.$transaction([
    prisma.investmentDeclaration.deleteMany({ where: { employeeId } }),
    prisma.previousEmployerIncome.deleteMany({ where: { employeeId } }),
    prisma.employeeSalaryStructure.deleteMany({ where: { employeeId } }),
    prisma.employee.delete({ where: { id: employeeId } }),
  ]);

  revalidatePath("/employees");
  redirect("/employees");
}
