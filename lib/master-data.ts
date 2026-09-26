// Master lists used by the seed script and by the Salary Structure /
// Import Wizard UIs to validate component codes and bank template codes.

export const SALARY_COMPONENTS: {
  code: string;
  name: string;
  category: "EARNING" | "EMPLOYER_CONTRIBUTION" | "DEDUCTION";
  taxability: "TAXABLE" | "EXEMPT" | "PARTIALLY_EXEMPT";
  order: number;
}[] = [
  // Earnings
  { code: "BASIC", name: "Basic Salary", category: "EARNING", taxability: "TAXABLE", order: 1 },
  { code: "DA", name: "Dearness Allowance", category: "EARNING", taxability: "TAXABLE", order: 2 },
  { code: "HRA", name: "House Rent Allowance", category: "EARNING", taxability: "PARTIALLY_EXEMPT", order: 3 },
  { code: "SPECIAL_ALLOWANCE", name: "Special Allowance", category: "EARNING", taxability: "TAXABLE", order: 4 },
  { code: "CONVEYANCE", name: "Conveyance Allowance", category: "EARNING", taxability: "TAXABLE", order: 5 },
  { code: "TRANSPORT_ALLOWANCE", name: "Transport Allowance", category: "EARNING", taxability: "TAXABLE", order: 6 },
  { code: "MEDICAL_ALLOWANCE", name: "Medical Allowance", category: "EARNING", taxability: "TAXABLE", order: 7 },
  { code: "LTA", name: "LTA / LTC", category: "EARNING", taxability: "PARTIALLY_EXEMPT", order: 8 },
  { code: "BONUS", name: "Bonus", category: "EARNING", taxability: "TAXABLE", order: 9 },
  { code: "INCENTIVE", name: "Incentive", category: "EARNING", taxability: "TAXABLE", order: 10 },
  { code: "COMMISSION", name: "Commission", category: "EARNING", taxability: "TAXABLE", order: 11 },
  { code: "OVERTIME", name: "Overtime", category: "EARNING", taxability: "TAXABLE", order: 12 },
  { code: "ARREARS", name: "Arrears", category: "EARNING", taxability: "TAXABLE", order: 13 },
  { code: "PERFORMANCE_PAY", name: "Performance Pay", category: "EARNING", taxability: "TAXABLE", order: 14 },
  { code: "OTHER_ALLOWANCE", name: "Other Allowances", category: "EARNING", taxability: "TAXABLE", order: 15 },
  // Employer contributions
  { code: "EMPLOYER_PF", name: "Employer PF Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 20 },
  { code: "EMPLOYER_NPS", name: "Employer NPS Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 21 },
  { code: "EMPLOYER_SUPERANNUATION", name: "Employer Superannuation Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 22 },
  { code: "GRATUITY", name: "Gratuity", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 23 },
  { code: "OTHER_EMPLOYER_BENEFIT", name: "Other Employer Benefits", category: "EMPLOYER_CONTRIBUTION", taxability: "TAXABLE", order: 24 },
  // Deductions
  { code: "EMPLOYEE_PF", name: "Employee PF Contribution", category: "DEDUCTION", taxability: "EXEMPT", order: 30 },
  { code: "EMPLOYEE_ESI", name: "Employee ESI Contribution", category: "DEDUCTION", taxability: "EXEMPT", order: 31 },
  { code: "PROFESSIONAL_TAX", name: "Professional Tax", category: "DEDUCTION", taxability: "EXEMPT", order: 32 },
  { code: "LWF", name: "Labour Welfare Fund", category: "DEDUCTION", taxability: "EXEMPT", order: 33 },
  { code: "SALARY_ADVANCE", name: "Salary Advance Recovery", category: "DEDUCTION", taxability: "EXEMPT", order: 34 },
  { code: "LOAN_RECOVERY", name: "Loan Recovery", category: "DEDUCTION", taxability: "EXEMPT", order: 35 },
  { code: "OTHER_DEDUCTION", name: "Other Deductions", category: "DEDUCTION", taxability: "EXEMPT", order: 36 },
];

export const BANK_FILE_TEMPLATES: {
  bankName: string;
  code: string;
  delimiter: string;
  columns: { header: string; field: string; format?: string }[];
}[] = [
  {
    bankName: "Generic",
    code: "GENERIC_CSV",
    delimiter: ",",
    columns: [
      { header: "Employee Code", field: "employeeCode" },
      { header: "Employee Name", field: "employeeName" },
      { header: "Bank Name", field: "bankName" },
      { header: "Account Number", field: "accountNumber" },
      { header: "IFSC", field: "ifsc" },
      { header: "Net Salary", field: "netSalary", format: "amount" },
      { header: "Payment Month", field: "paymentMonth" },
      { header: "Payment Reference", field: "paymentReference" },
    ],
  },
  {
    bankName: "HDFC Bank",
    code: "HDFC_BULK_SALARY",
    delimiter: ",",
    columns: [
      { header: "Beneficiary Code", field: "employeeCode" },
      { header: "Beneficiary Name", field: "employeeName" },
      { header: "Beneficiary Account No", field: "accountNumber" },
      { header: "IFSC Code", field: "ifsc" },
      { header: "Amount", field: "netSalary", format: "amount" },
      { header: "Payment Date", field: "paymentMonth" },
      { header: "Narration", field: "paymentReference" },
    ],
  },
  {
    bankName: "ICICI Bank",
    code: "ICICI_CMS",
    delimiter: ",",
    columns: [
      { header: "Debit A/c No", field: "companyAccountNumber" },
      { header: "Beneficiary Name", field: "employeeName" },
      { header: "Beneficiary A/c No", field: "accountNumber" },
      { header: "IFSC", field: "ifsc" },
      { header: "Amount", field: "netSalary", format: "amount" },
      { header: "Ref No", field: "paymentReference" },
    ],
  },
];
