import { prisma } from "@/lib/db";
import { IFSC_REGEX } from "@/lib/validation";
import { FY_MONTH_NAMES } from "@/lib/types";

export interface BankFileRow {
  employeeCode: string;
  employeeName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  companyAccountNumber: string;
  netSalary: number;
  paymentMonth: string;
  paymentReference: string;
}

export interface BankFileValidationIssue {
  employeeCode: string;
  employeeName: string;
  issue: string;
}

export async function buildBankFileData(payrollRunId: string) {
  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: payrollRunId },
    include: { financialYear: true, lines: { include: { employee: true } } },
  });
  const company = await prisma.company.findFirst();

  const rows: BankFileRow[] = [];
  const issues: BankFileValidationIssue[] = [];
  const accountsSeen = new Map<string, string>();

  const monthLabel = `${FY_MONTH_NAMES[run.payrollMonthIndex - 1]} ${run.calendarYear}`;

  for (const line of run.lines) {
    const e = line.employee;
    const label = `${e.employeeCode} - ${e.fullName}`;
    if (!e.bankAccountNo) {
      issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing bank account number" });
    }
    if (!e.bankIfsc) {
      issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing IFSC code" });
    } else if (!IFSC_REGEX.test(e.bankIfsc)) {
      issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: `Invalid IFSC format '${e.bankIfsc}'` });
    }
    if (e.bankAccountNo) {
      const prior = accountsSeen.get(e.bankAccountNo);
      if (prior) {
        issues.push({
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          issue: `Bank account ${e.bankAccountNo} is also used by ${prior}`,
        });
      } else {
        accountsSeen.set(e.bankAccountNo, label);
      }
    }
    if (line.netSalary <= 0) {
      issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: `Net salary is ${line.netSalary <= 0 ? "zero or negative" : ""} (Rs ${line.netSalary})` });
    }
    if (!e.bankName) {
      issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing bank name" });
    }

    rows.push({
      employeeCode: e.employeeCode,
      employeeName: e.fullName,
      bankName: e.bankName ?? "",
      accountNumber: e.bankAccountNo ?? "",
      ifsc: e.bankIfsc ?? "",
      companyAccountNumber: company?.bankAccountNo ?? "",
      netSalary: line.netSalary,
      paymentMonth: monthLabel,
      paymentReference: `SAL-${run.financialYear.code}-${String(run.payrollMonthIndex).padStart(2, "0")}-${e.employeeCode}`,
    });
  }

  return { run, rows, issues, monthLabel };
}
