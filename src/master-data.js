// Ported verbatim from lib/master-data.ts
const SALARY_COMPONENTS = [
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
  { code: "CHILDREN_EDUCATION_ALLOWANCE", name: "Children Education Allowance", category: "EARNING", taxability: "PARTIALLY_EXEMPT", order: 16 },
  { code: "HOSTEL_ALLOWANCE", name: "Children Hostel Allowance", category: "EARNING", taxability: "PARTIALLY_EXEMPT", order: 17 },
  { code: "EMPLOYER_PF", name: "Employer PF Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 20 },
  { code: "EMPLOYER_NPS", name: "Employer NPS Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 21 },
  { code: "EMPLOYER_SUPERANNUATION", name: "Employer Superannuation Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 22 },
  { code: "GRATUITY", name: "Gratuity", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 23 },
  { code: "OTHER_EMPLOYER_BENEFIT", name: "Other Employer Benefits", category: "EMPLOYER_CONTRIBUTION", taxability: "TAXABLE", order: 24 },
  { code: "EMPLOYER_ESI", name: "Employer ESI Contribution", category: "EMPLOYER_CONTRIBUTION", taxability: "EXEMPT", order: 25 },
  { code: "EMPLOYEE_PF", name: "Employee PF Contribution", category: "DEDUCTION", taxability: "EXEMPT", order: 30 },
  { code: "EMPLOYEE_ESI", name: "Employee ESI Contribution", category: "DEDUCTION", taxability: "EXEMPT", order: 31 },
  { code: "PROFESSIONAL_TAX", name: "Professional Tax", category: "DEDUCTION", taxability: "EXEMPT", order: 32 },
  { code: "LWF", name: "Labour Welfare Fund", category: "DEDUCTION", taxability: "EXEMPT", order: 33 },
  { code: "SALARY_ADVANCE", name: "Salary Advance Recovery", category: "DEDUCTION", taxability: "EXEMPT", order: 34 },
  { code: "LOAN_RECOVERY", name: "Loan Recovery", category: "DEDUCTION", taxability: "EXEMPT", order: 35 },
  { code: "OTHER_DEDUCTION", name: "Other Deductions", category: "DEDUCTION", taxability: "EXEMPT", order: 36 },
];

const BANK_FILE_TEMPLATES = [
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
    // Exact column layout of the bank's own HDFC bulk salary upload sheet
    // (a real sample was provided) - every column is a plain text cell
    // except Amount, which must stay numeric; see buildBankFileWorkbookRows
    // in payroll-runs.js, which is what actually enforces that per-column
    // cell typing (fileType/includeControlTotalRow below drive it). A
    // trailing control-total row (blank except Amount = sum of all rows) is
    // part of the bank's own format, not something the app adds on top.
    bankName: "HDFC Bank",
    code: "HDFC_BULK_SALARY",
    fileType: "xlsx",
    includeControlTotalRow: true,
    columns: [
      { header: "Transaction Ref No", field: "transactionRefNo" },
      { header: "Amount", field: "amount", format: "amount" },
      { header: "Value Date", field: "valueDate" },
      { header: "Branch Code", field: "branchCode" },
      { header: "Senders Account Type", field: "sendersAccountType" },
      { header: "Remitter Account No", field: "remitterAccountNo" },
      { header: "Remitters Name", field: "remittersName" },
      { header: "IFSC Code", field: "ifsc" },
      { header: "Debit Account", field: "debitAccount" },
      { header: "Beneficiary Account Type", field: "beneficiaryAccountType" },
      { header: "Bank Account Number", field: "accountNumber" },
      { header: "Beneficiary Name", field: "employeeName" },
      { header: "Remittance Details", field: "remittanceDetailsHdfc" },
      { header: "Debit Account System", field: "debitAccountSystem" },
      { header: "Originator Of Remmittance", field: "originatorOfRemmittance" },
      { header: "Emailmobileno", field: "companyEmail" },
    ],
  },
  {
    // Exact column layout of the bank's own ICICI format (a real sample was
    // provided). "Cheque / RTGS Slip No" is left blank - the user fills it
    // in by hand per batch when they submit the file, it isn't derivable
    // from payroll data. "BENEFICIARY LEI" is also left blank (only
    // applicable above a large transaction-value threshold).
    bankName: "ICICI Bank",
    code: "ICICI_CMS",
    fileType: "xlsx",
    columns: [
      { header: "Sr. No.", field: "transactionRefNo" },
      { header: "Cheque / RTGS Slip No", field: "chequeOrRtgsSlipNo" },
      { header: "SENDER ACCOUNT NO", field: "remitterAccountNo" },
      { header: "AMOUNT", field: "amount", format: "amount" },
      { header: "BENEFICIARY ACCOUNT NO", field: "accountNumber" },
      { header: "BENEFICIARY ACCOUNT NAME", field: "employeeName" },
      { header: "BENEFICIARY IFSC", field: "ifsc" },
      { header: "BENEFICIARY LEI (If applicable)", field: "beneficiaryLei" },
      { header: "Remarks", field: "remarksIcici" },
    ],
  },
];

// Dated statutory wage ceilings - each entry is a complete snapshot in force
// from its effectiveFrom date (same "latest row on or before the date"
// lookup pattern as TAX_RULE_CONFIGS/db.taxRuleSets), editable under
// Settings so a future rate change never needs a code change.
const WAGE_CEILING_CONFIGS = [
  {
    effectiveFrom: "2017-01-01",
    esiWageCeiling: 21000,
    esiWageCeilingDisability: 25000,
    pfWageCeiling: 15000,
    esiEmployeeRate: 0.0075,
    esiEmployerRate: 0.0325,
    esiEmployeeExemptDailyWage: 176,
    notes: "ESI wage ceiling Rs 21,000 (Rs 25,000 for persons with disability) effective 1-Jan-2017; EPF wage ceiling Rs 15,000 effective 1-Sep-2014. ESI contribution 0.75% employee / 3.25% employer effective 1-Jul-2019.",
  },
  {
    effectiveFrom: "2026-09-17",
    esiWageCeiling: 21000,
    esiWageCeilingDisability: 25000,
    pfWageCeiling: 25000,
    esiEmployeeRate: 0.0075,
    esiEmployerRate: 0.0325,
    esiEmployeeExemptDailyWage: 176,
    notes: "EPF wage ceiling raised to Rs 25,000 effective 17-Sep-2026.",
  },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SALARY_COMPONENTS, BANK_FILE_TEMPLATES, WAGE_CEILING_CONFIGS };
}
