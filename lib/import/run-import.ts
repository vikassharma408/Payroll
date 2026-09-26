import { prisma } from "@/lib/db";
import { PAN_REGEX, IFSC_REGEX } from "@/lib/validation";
import { IMPORT_TEMPLATES } from "./spec";
import { parseWorkbookRows } from "./excel";
import type { ImportTemplateType } from "@/lib/types";
import { computeEmployeePayrollLine } from "@/lib/payroll/engine";
import { addAdjustment } from "@/lib/payroll/workflow";
import { FY_MONTH_NAMES } from "@/lib/types";

export interface ImportSummary {
  batchId: string;
  templateType: ImportTemplateType;
  totalRecords: number;
  importedRecords: number;
  failedRecords: number;
  errors: { rowNumber: number; message: string }[];
}

function toBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return ["y", "yes", "true", "1"].includes(s);
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function requiredFieldsPresent(type: ImportTemplateType, row: Record<string, unknown>, errors: string[]) {
  for (const col of IMPORT_TEMPLATES[type].columns) {
    if (col.required && (row[col.header] === null || row[col.header] === undefined || row[col.header] === "")) {
      errors.push(`Missing required field '${col.header}'`);
    }
  }
}

async function importEmployees(rows: Record<string, unknown>[]) {
  const errors: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const seenCodes = new Set<string>();
  const seenPans = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // header is row 1
    const row = rows[i];
    const rowErrors: string[] = [];
    requiredFieldsPresent("EMPLOYEE", row, rowErrors);

    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const pan = String(row["PAN"] ?? "").trim().toUpperCase() || null;
    if (employeeCode) {
      if (seenCodes.has(employeeCode)) rowErrors.push(`Duplicate employee code '${employeeCode}' within this file`);
      seenCodes.add(employeeCode);
      const existing = await prisma.employee.findUnique({ where: { employeeCode } });
      if (existing) rowErrors.push(`Employee code '${employeeCode}' already exists`);
    }
    if (pan) {
      if (!PAN_REGEX.test(pan)) rowErrors.push(`Invalid PAN format '${pan}'`);
      if (seenPans.has(pan)) rowErrors.push(`Duplicate PAN '${pan}' within this file`);
      seenPans.add(pan);
      const existingPan = await prisma.employee.findFirst({ where: { pan } });
      if (existingPan) rowErrors.push(`PAN '${pan}' already used by another employee`);
    }
    const dateOfJoining = toDateOrNull(row["Date of Joining"]);
    if (row["Date of Joining"] && !dateOfJoining) rowErrors.push("Invalid Date of Joining");
    const ifsc = String(row["IFSC"] ?? "").trim().toUpperCase() || null;
    if (ifsc && !IFSC_REGEX.test(ifsc)) rowErrors.push(`Invalid IFSC format '${ifsc}'`);
    const taxRegime = String(row["Tax Regime"] ?? "NEW").trim().toUpperCase() || "NEW";
    if (!["OLD", "NEW"].includes(taxRegime)) rowErrors.push(`Invalid tax regime '${taxRegime}' (must be OLD or NEW)`);

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    await prisma.employee.create({
      data: {
        employeeCode,
        fullName: String(row["Employee Name"] ?? "").trim(),
        pan,
        dob: toDateOrNull(row["DOB"]),
        gender: row["Gender"] ? String(row["Gender"]) : null,
        dateOfJoining: dateOfJoining!,
        department: row["Department"] ? String(row["Department"]) : null,
        designation: row["Designation"] ? String(row["Designation"]) : null,
        location: row["Location"] ? String(row["Location"]) : null,
        bankName: row["Bank Name"] ? String(row["Bank Name"]) : null,
        bankAccountNo: row["Account Number"] ? String(row["Account Number"]) : null,
        bankIfsc: ifsc,
        uan: row["UAN"] ? String(row["UAN"]) : null,
        pfApplicable: toBool(row["PF Applicable"] ?? "Y"),
        esiApplicable: toBool(row["ESI Applicable"] ?? "N"),
        ptApplicable: toBool(row["Professional Tax Applicable"] ?? "Y"),
        taxRegime,
        status: "ACTIVE",
      },
    });
    imported++;
  }
  return { imported, errors };
}

async function getCurrentFinancialYear() {
  const fy = await prisma.financialYear.findFirst({ where: { isCurrent: true } });
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");
  return fy;
}

async function importSalaryStructures(rows: Record<string, unknown>[]) {
  const errors: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const fy = await getCurrentFinancialYear();
  const components = await prisma.salaryComponent.findMany();
  const componentByCode = new Map(components.map((c) => [c.code, c]));
  const numericFields = IMPORT_TEMPLATES.SALARY_STRUCTURE.columns.filter((c) => c.type === "number");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors: string[] = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    const employee = employeeCode ? await prisma.employee.findUnique({ where: { employeeCode } }) : null;
    if (employeeCode && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const amounts: { code: string; monthly: number }[] = [];
    for (const col of numericFields) {
      const annual = toNumber(row[col.header]);
      if (Number.isNaN(annual)) rowErrors.push(`Invalid number for '${col.header}'`);
      else if (annual < 0) rowErrors.push(`'${col.header}' cannot be negative`);
      else if (annual > 0) amounts.push({ code: col.field, monthly: Math.round((annual / 12) * 100) / 100 });
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const annualCTC = amounts.reduce((s, a) => s + a.monthly * 12, 0);
    await prisma.$transaction(async (tx) => {
      await tx.employeeSalaryStructure.updateMany({
        where: { employeeId: employee!.id, financialYearId: fy.id, isActive: true },
        data: { isActive: false, effectiveTo: new Date() },
      });
      const structure = await tx.employeeSalaryStructure.create({
        data: { employeeId: employee!.id, financialYearId: fy.id, annualCTC, effectiveFrom: new Date(), isActive: true },
      });
      for (const a of amounts) {
        const comp = componentByCode.get(a.code);
        if (!comp) continue;
        await tx.employeeSalaryComponentValue.create({
          data: {
            structureId: structure.id,
            componentId: comp.id,
            monthlyAmount: a.monthly,
            annualAmount: a.monthly * 12,
            formulaUsed: `Imported fixed amount: Rs ${(a.monthly * 12).toLocaleString("en-IN")}/year`,
          },
        });
      }
    });
    imported++;
  }
  return { imported, errors };
}

async function importInvestmentDeclarations(rows: Record<string, unknown>[]) {
  const errors: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const fy = await getCurrentFinancialYear();
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors: string[] = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? await prisma.employee.findUnique({ where: { employeeCode } }) : null;
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (!employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const regime = String(row["Tax Regime"] ?? employee?.taxRegime ?? "NEW").toUpperCase();
    if (regime && !["OLD", "NEW"].includes(regime)) rowErrors.push(`Invalid tax regime '${regime}'`);

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    if (employee && regime !== employee.taxRegime) {
      await prisma.employee.update({ where: { id: employee.id }, data: { taxRegime: regime } });
    }

    await prisma.investmentDeclaration.upsert({
      where: { employeeId_financialYearId: { employeeId: employee!.id, financialYearId: fy.id } },
      update: {
        otherSection80C: toNumber(row["80C"]),
        section80DSelfBelow60: toNumber(row["80D"]),
        section80CCD1B: toNumber(row["80CCD"]),
        homeLoanInterestSelfOccupied: toNumber(row["Home Loan Interest"]),
        section80E: toNumber(row["Education Loan Interest"]),
        donations80G: toNumber(row["Donations"]),
        monthlyRent: toNumber(row["HRA Rent"]),
        ltaClaimed: toNumber(row["LTA"]),
        otherDeductions: toNumber(row["Other Eligible Deductions"]),
      },
      create: {
        employeeId: employee!.id,
        financialYearId: fy.id,
        otherSection80C: toNumber(row["80C"]),
        section80DSelfBelow60: toNumber(row["80D"]),
        section80CCD1B: toNumber(row["80CCD"]),
        homeLoanInterestSelfOccupied: toNumber(row["Home Loan Interest"]),
        section80E: toNumber(row["Education Loan Interest"]),
        donations80G: toNumber(row["Donations"]),
        monthlyRent: toNumber(row["HRA Rent"]),
        ltaClaimed: toNumber(row["LTA"]),
        otherDeductions: toNumber(row["Other Eligible Deductions"]),
      },
    });
    imported++;
  }
  return { imported, errors };
}

async function importPreviousEmployer(rows: Record<string, unknown>[]) {
  const errors: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const fy = await getCurrentFinancialYear();
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors: string[] = [];
    requiredFieldsPresent("PREVIOUS_EMPLOYER", row, rowErrors);
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? await prisma.employee.findUnique({ where: { employeeCode } }) : null;
    if (employeeCode && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);
    const grossSalary = toNumber(row["Salary"]);
    const taxableSalary = toNumber(row["Taxable Salary"]);
    if (grossSalary < 0 || taxableSalary < 0) rowErrors.push("Salary figures cannot be negative");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    await prisma.previousEmployerIncome.create({
      data: {
        employeeId: employee!.id,
        financialYearId: fy.id,
        employerName: String(row["Previous Employer"]),
        periodFrom: fy.startDate,
        periodTo: employee!.dateOfJoining < fy.endDate ? employee!.dateOfJoining : fy.startDate,
        grossSalary,
        taxableSalary,
        exemptions: toNumber(row["Exemptions"]),
        deductions: toNumber(row["Deductions"]),
        tdsDeducted: toNumber(row["TDS"]),
      },
    });
    imported++;
  }
  return { imported, errors };
}

async function importMonthlyPayroll(rows: Record<string, unknown>[]) {
  const errors: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const fy = await getCurrentFinancialYear();
  const VARIABLE_FIELDS: { header: string; label: string }[] = [
    { header: "Bonus", label: "Bonus" },
    { header: "Incentive", label: "Incentive" },
    { header: "Overtime", label: "Overtime" },
    { header: "Arrears", label: "Arrears" },
    { header: "Other Earnings", label: "Other Earnings" },
  ];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors: string[] = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? await prisma.employee.findUnique({ where: { employeeCode } }) : null;
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (!employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const monthName = String(row["Payroll Month"] ?? "").trim();
    const monthIndex = FY_MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName.toLowerCase()) + 1;
    if (monthIndex === 0) rowErrors.push(`Invalid Payroll Month '${monthName}' (use April, May, ... March)`);

    const lopDays = toNumber(row["LOP Days"]);
    if (Number.isNaN(lopDays) || lopDays < 0) rowErrors.push("LOP Days must be a non-negative number");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const run = await prisma.payrollRun.findFirst({
      where: { financialYearId: fy.id, payrollMonthIndex: monthIndex, payrollGroup: null },
    });
    if (!run) {
      errors.push({ rowNumber, message: `No payroll run exists yet for ${monthName} ${fy.code}. Create it first, then re-import.` });
      continue;
    }
    if (run.status === "LOCKED" || run.status === "PAID") {
      errors.push({ rowNumber, message: `Payroll run for ${monthName} ${fy.code} is ${run.status}; apply changes via an adjustment instead.` });
      continue;
    }

    try {
      const result = await computeEmployeePayrollLine(run.id, employee!.id, { lopDays });
      const line = await prisma.payrollRunLine.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: employee!.id } },
        create: {
          payrollRunId: run.id,
          employeeId: employee!.id,
          daysInMonth: result.daysInMonth,
          daysWorked: result.daysWorked,
          lopDays: result.lopDays,
          earnings: JSON.stringify(result.earnings),
          grossSalary: result.grossSalary,
          employerContributions: JSON.stringify(result.employerContributions),
          totalEmployerCost: result.totalEmployerCost,
          deductions: JSON.stringify(result.deductions),
          tdsMonthly: result.tdsMonthly,
          totalDeductions: result.totalDeductions,
          netSalary: result.netSalary,
          regimeUsed: result.regimeUsed,
          taxCalcSnapshot: JSON.stringify(result.taxCalcSnapshot),
          metrics: JSON.stringify(result.metrics),
        },
        update: {
          daysWorked: result.daysWorked,
          lopDays: result.lopDays,
          earnings: JSON.stringify(result.earnings),
          grossSalary: result.grossSalary,
          employerContributions: JSON.stringify(result.employerContributions),
          totalEmployerCost: result.totalEmployerCost,
          deductions: JSON.stringify(result.deductions),
          tdsMonthly: result.tdsMonthly,
          totalDeductions: result.totalDeductions,
          netSalary: result.netSalary,
          regimeUsed: result.regimeUsed,
          taxCalcSnapshot: JSON.stringify(result.taxCalcSnapshot),
          metrics: JSON.stringify(result.metrics),
        },
      });

      for (const f of VARIABLE_FIELDS) {
        const amt = toNumber(row[f.header]);
        if (amt) {
          await addAdjustment({
            payrollRunLineId: line.id,
            amount: amt,
            reason: `Imported monthly input: ${f.label}`,
            enteredBy: "Import Wizard",
          });
        }
      }
      const otherDed = toNumber(row["Other Deductions"]);
      if (otherDed) {
        await addAdjustment({
          payrollRunLineId: line.id,
          amount: -otherDed,
          reason: "Imported monthly input: Other Deductions",
          enteredBy: "Import Wizard",
        });
      }
      imported++;
    } catch (err) {
      errors.push({ rowNumber, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { imported, errors };
}

export async function runImport(type: ImportTemplateType, buffer: Buffer, fileName: string): Promise<ImportSummary> {
  const rows = parseWorkbookRows(buffer, IMPORT_TEMPLATES[type].sheetName);
  let result: { imported: number; errors: { rowNumber: number; message: string }[] };

  switch (type) {
    case "EMPLOYEE":
      result = await importEmployees(rows);
      break;
    case "SALARY_STRUCTURE":
      result = await importSalaryStructures(rows);
      break;
    case "INVESTMENT":
      result = await importInvestmentDeclarations(rows);
      break;
    case "PREVIOUS_EMPLOYER":
      result = await importPreviousEmployer(rows);
      break;
    case "MONTHLY_PAYROLL":
      result = await importMonthlyPayroll(rows);
      break;
  }

  const batch = await prisma.importBatch.create({
    data: {
      templateType: type,
      fileName,
      totalRecords: rows.length,
      importedRecords: result.imported,
      failedRecords: result.errors.length,
      status: result.errors.length === 0 ? "COMPLETED" : result.imported === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS",
      errors: { create: result.errors },
    },
  });

  return {
    batchId: batch.id,
    templateType: type,
    totalRecords: rows.length,
    importedRecords: result.imported,
    failedRecords: result.errors.length,
    errors: result.errors,
  };
}
