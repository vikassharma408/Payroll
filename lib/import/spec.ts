import type { ImportTemplateType } from "@/lib/types";

export type ColumnType = "string" | "number" | "date" | "boolean" | "enum";

export interface ImportColumnSpec {
  header: string;
  field: string;
  required?: boolean;
  type: ColumnType;
  enumValues?: string[];
  example?: string | number;
}

export const IMPORT_TEMPLATES: Record<ImportTemplateType, { sheetName: string; columns: ImportColumnSpec[] }> = {
  EMPLOYEE: {
    sheetName: "Employee Master",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Employee Name", field: "fullName", required: true, type: "string", example: "Ravi Kumar" },
      { header: "PAN", field: "pan", type: "string", example: "ABCPK1234A" },
      { header: "DOB", field: "dob", type: "date", example: "1990-01-31" },
      { header: "Gender", field: "gender", type: "string", example: "Male" },
      { header: "Date of Joining", field: "dateOfJoining", required: true, type: "date", example: "2024-06-01" },
      { header: "Department", field: "department", type: "string", example: "Finance" },
      { header: "Designation", field: "designation", type: "string", example: "Executive" },
      { header: "Location", field: "location", type: "string", example: "Mumbai" },
      { header: "Bank Name", field: "bankName", type: "string", example: "HDFC Bank" },
      { header: "Account Number", field: "bankAccountNo", type: "string", example: "50100123456789" },
      { header: "IFSC", field: "bankIfsc", type: "string", example: "HDFC0000123" },
      { header: "UAN", field: "uan", type: "string", example: "100123456789" },
      { header: "PF Applicable", field: "pfApplicable", type: "boolean", example: "Y" },
      { header: "ESI Applicable", field: "esiApplicable", type: "boolean", example: "N" },
      { header: "Professional Tax Applicable", field: "ptApplicable", type: "boolean", example: "Y" },
      { header: "Tax Regime", field: "taxRegime", type: "enum", enumValues: ["OLD", "NEW"], example: "NEW" },
    ],
  },
  SALARY_STRUCTURE: {
    sheetName: "Salary Structure",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Basic", field: "BASIC", type: "number", example: 30000 },
      { header: "HRA", field: "HRA", type: "number", example: 15000 },
      { header: "Special Allowance", field: "SPECIAL_ALLOWANCE", type: "number", example: 10000 },
      { header: "Conveyance", field: "CONVEYANCE", type: "number", example: 1600 },
      { header: "LTA", field: "LTA", type: "number", example: 0 },
      { header: "Bonus", field: "BONUS", type: "number", example: 0 },
      { header: "Other Allowances", field: "OTHER_ALLOWANCE", type: "number", example: 0 },
      { header: "Employer PF", field: "EMPLOYER_PF", type: "number", example: 3600 },
      { header: "Employer NPS", field: "EMPLOYER_NPS", type: "number", example: 0 },
      { header: "Other Components", field: "OTHER_EMPLOYER_BENEFIT", type: "number", example: 0 },
    ],
  },
  INVESTMENT: {
    sheetName: "Investment Declaration",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Tax Regime", field: "taxRegime", type: "enum", enumValues: ["OLD", "NEW"], example: "OLD" },
      { header: "80C", field: "section80C", type: "number", example: 150000 },
      { header: "80D", field: "section80D", type: "number", example: 25000 },
      { header: "80CCD", field: "section80CCD", type: "number", example: 50000 },
      { header: "Home Loan Interest", field: "homeLoanInterest", type: "number", example: 0 },
      { header: "Education Loan Interest", field: "educationLoanInterest", type: "number", example: 0 },
      { header: "Donations", field: "donations", type: "number", example: 0 },
      { header: "HRA Rent", field: "monthlyRent", type: "number", example: 20000 },
      { header: "LTA", field: "lta", type: "number", example: 0 },
      { header: "Other Eligible Deductions", field: "otherDeductions", type: "number", example: 0 },
    ],
  },
  PREVIOUS_EMPLOYER: {
    sheetName: "Previous Employer",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Previous Employer", field: "employerName", required: true, type: "string", example: "Acme Corp Pvt Ltd" },
      { header: "Salary", field: "grossSalary", required: true, type: "number", example: 400000 },
      { header: "Taxable Salary", field: "taxableSalary", required: true, type: "number", example: 370000 },
      { header: "Exemptions", field: "exemptions", type: "number", example: 10000 },
      { header: "Deductions", field: "deductions", type: "number", example: 20000 },
      { header: "TDS", field: "tdsDeducted", type: "number", example: 15000 },
    ],
  },
  MONTHLY_PAYROLL: {
    sheetName: "Monthly Payroll Input",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Payroll Month", field: "payrollMonth", required: true, type: "string", example: "April" },
      { header: "Basic", field: "basic", type: "number", example: 30000 },
      { header: "HRA", field: "hra", type: "number", example: 15000 },
      { header: "Allowances", field: "allowances", type: "number", example: 0 },
      { header: "Bonus", field: "bonus", type: "number", example: 0 },
      { header: "Incentive", field: "incentive", type: "number", example: 0 },
      { header: "Overtime", field: "overtime", type: "number", example: 0 },
      { header: "Arrears", field: "arrears", type: "number", example: 0 },
      { header: "LOP Days", field: "lopDays", type: "number", example: 0 },
      { header: "Other Earnings", field: "otherEarnings", type: "number", example: 0 },
      { header: "Other Deductions", field: "otherDeductions", type: "number", example: 0 },
    ],
  },
};
