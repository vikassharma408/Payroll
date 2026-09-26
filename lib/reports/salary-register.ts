import { prisma } from "@/lib/db";

const OTHER_ALLOWANCE_CODES = ["DA", "TRANSPORT_ALLOWANCE", "MEDICAL_ALLOWANCE", "LTA", "COMMISSION", "OVERTIME", "ARREARS", "PERFORMANCE_PAY", "OTHER_ALLOWANCE"];
const OTHER_DEDUCTION_CODES = ["SALARY_ADVANCE", "LOAN_RECOVERY", "OTHER_DEDUCTION"];
const OTHER_EMPLOYER_CODES = ["EMPLOYER_SUPERANNUATION", "OTHER_EMPLOYER_BENEFIT"];

function sumCodes(map: Record<string, number>, codes: string[]) {
  return codes.reduce((s, c) => s + (map[c] ?? 0), 0);
}

export interface SalaryRegisterRow {
  employeeCode: string;
  employeeName: string;
  pan: string;
  department: string;
  designation: string;
  basic: number;
  hra: number;
  specialAllowance: number;
  otherAllowances: number;
  bonus: number;
  incentive: number;
  grossSalary: number;
  employeePf: number;
  employeeEsi: number;
  professionalTax: number;
  lwf: number;
  otherDeductions: number;
  tds: number;
  totalDeductions: number;
  netSalary: number;
  employerPf: number;
  employerEsi: number;
  gratuity: number;
  employerNps: number;
  otherEmployerCost: number;
  totalCtc: number;
}

export async function getSalaryRegisterRows(payrollRunId: string): Promise<SalaryRegisterRow[]> {
  const lines = await prisma.payrollRunLine.findMany({
    where: { payrollRunId },
    include: { employee: true },
    orderBy: { employee: { employeeCode: "asc" } },
  });

  return lines.map((line) => {
    const e = JSON.parse(line.earnings) as Record<string, number>;
    const ec = JSON.parse(line.employerContributions) as Record<string, number>;
    const d = JSON.parse(line.deductions) as Record<string, number>;
    return {
      employeeCode: line.employee.employeeCode,
      employeeName: line.employee.fullName,
      pan: line.employee.pan ?? "",
      department: line.employee.department ?? "",
      designation: line.employee.designation ?? "",
      basic: e["BASIC"] ?? 0,
      hra: e["HRA"] ?? 0,
      specialAllowance: e["SPECIAL_ALLOWANCE"] ?? 0,
      otherAllowances: sumCodes(e, OTHER_ALLOWANCE_CODES),
      bonus: e["BONUS"] ?? 0,
      incentive: e["INCENTIVE"] ?? 0,
      grossSalary: line.grossSalary,
      employeePf: d["EMPLOYEE_PF"] ?? 0,
      employeeEsi: d["EMPLOYEE_ESI"] ?? 0,
      professionalTax: d["PROFESSIONAL_TAX"] ?? 0,
      lwf: d["LWF"] ?? 0,
      otherDeductions: sumCodes(d, OTHER_DEDUCTION_CODES),
      tds: line.tdsMonthly,
      totalDeductions: line.totalDeductions,
      netSalary: line.netSalary,
      employerPf: ec["EMPLOYER_PF"] ?? 0,
      employerEsi: ec["EMPLOYER_ESI"] ?? 0,
      gratuity: ec["GRATUITY"] ?? 0,
      employerNps: ec["EMPLOYER_NPS"] ?? 0,
      otherEmployerCost: sumCodes(ec, OTHER_EMPLOYER_CODES),
      totalCtc: line.totalEmployerCost,
    };
  });
}

export const SALARY_REGISTER_COLUMNS: { header: string; field: keyof SalaryRegisterRow }[] = [
  { header: "Employee Code", field: "employeeCode" },
  { header: "Employee Name", field: "employeeName" },
  { header: "PAN", field: "pan" },
  { header: "Department", field: "department" },
  { header: "Designation", field: "designation" },
  { header: "Basic", field: "basic" },
  { header: "HRA", field: "hra" },
  { header: "Special Allowance", field: "specialAllowance" },
  { header: "Other Allowances", field: "otherAllowances" },
  { header: "Bonus", field: "bonus" },
  { header: "Incentive", field: "incentive" },
  { header: "Gross Salary", field: "grossSalary" },
  { header: "Employee PF", field: "employeePf" },
  { header: "Employee ESI", field: "employeeEsi" },
  { header: "Professional Tax", field: "professionalTax" },
  { header: "LWF", field: "lwf" },
  { header: "Other Deductions", field: "otherDeductions" },
  { header: "TDS", field: "tds" },
  { header: "Total Deductions", field: "totalDeductions" },
  { header: "Net Salary", field: "netSalary" },
  { header: "Employer PF", field: "employerPf" },
  { header: "Employer ESI", field: "employerEsi" },
  { header: "Gratuity", field: "gratuity" },
  { header: "Total CTC / Employer Cost", field: "totalCtc" },
];
