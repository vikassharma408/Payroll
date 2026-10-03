// Import Wizard logic - ported from lib/import/{spec,excel,instructions,run-import}.ts.
// Uses the vendored SheetJS build (vendor/xlsx.full.min.js, loaded as the
// global `XLSX`) to read/write .xlsx files entirely client-side.

const IMPORT_TEMPLATES = {
  EMPLOYEE: {
    sheetName: "Employee Master",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Legal Entity", field: "companyId", type: "string", example: "My Company Pvt Ltd", note: "Which Company (legal entity) this employee belongs to, for a multi-entity setup. If it matches an existing company's name (from Setup > Companies) that company is used; if not, a new company is created automatically with that exact name (PAN/TAN/bank details can be filled in afterwards under Setup > Companies). Leave blank to use whichever company is active in the app when you run the import (fine if you only ever import one entity at a time)." },
      { header: "Employee Name", field: "fullName", required: true, type: "string", example: "Ravi Kumar" },
      { header: "PAN", field: "pan", type: "string", example: "ABCPK1234A" },
      { header: "DOB", field: "dob", type: "date", example: "1990-01-31" },
      { header: "Gender", field: "gender", type: "string", example: "Male" },
      { header: "Date of Joining", field: "dateOfJoining", required: true, type: "date", example: "2024-06-01" },
      { header: "Department", field: "department", type: "string", example: "Finance" },
      { header: "Designation", field: "designation", type: "string", example: "Executive" },
      { header: "Location", field: "location", type: "string", example: "Mumbai" },
      { header: "State", field: "state", type: "string", example: "Maharashtra", note: "Must match a state name from the in-app PT Slabs screen (e.g. Maharashtra, Karnataka, Delhi). Drives auto-calculated Professional Tax (see Professional Tax Applicable) and is used for the senior-citizen PT exemption. Leave blank if PT should always come from a fixed amount in the Salary Structure instead." },
      { header: "Bank Name", field: "bankName", type: "string", example: "HDFC Bank" },
      { header: "Account Number", field: "bankAccountNo", type: "string", example: "50100123456789" },
      { header: "IFSC", field: "bankIfsc", type: "string", example: "HDFC0000123" },
      { header: "UAN", field: "uan", type: "string", example: "100123456789" },
      { header: "PF Applicable", field: "pfApplicable", type: "boolean", example: "Y", note: "Override, not auto-detected: even if the Salary Structure tab has a PF line (incl. one generated from a Salary Structure Template), set to N to skip PF deduction/contribution for this employee only (e.g. above the PF wage ceiling)." },
      { header: "ESI Applicable", field: "esiApplicable", type: "boolean", example: "N", note: "Same as PF Applicable, for the ESI deduction." },
      { header: "Professional Tax Applicable", field: "ptApplicable", type: "boolean", example: "Y", note: "Set to Y with a State to auto-calculate PT from that state's slabs each month (overriding any fixed PT figure in the Salary Structure); set to N to keep a fixed manually-entered PT amount instead." },
      { header: "Tax Regime", field: "taxRegime", type: "enum", enumValues: ["OLD", "NEW"], example: "NEW" },
    ],
  },
  SALARY_STRUCTURE: {
    // No Bonus column here on purpose: every column on this sheet is a
    // recurring MONTHLY amount, paid every month for as long as this
    // structure is active. A one-time/annual bonus typed in here would be
    // silently paid 12 times over, not once. Use the "Monthly Payroll
    // Input" template (or the on-screen per-run override) for a bonus
    // instead - see runMonthlyPayrollInput/the payroll run's "One-Time Pay"
    // section.
    sheetName: "Salary Structure",
    columns: [
      { header: "Employee Code", field: "employeeCode", required: true, type: "string", example: "EMP101" },
      { header: "Basic", field: "BASIC", type: "number", example: 30000 },
      { header: "HRA", field: "HRA", type: "number", example: 15000 },
      { header: "Special Allowance", field: "SPECIAL_ALLOWANCE", type: "number", example: 10000 },
      { header: "Conveyance", field: "CONVEYANCE", type: "number", example: 1600 },
      { header: "LTA", field: "LTA", type: "number", example: 0 },
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
      { header: "Metro City (Y/N)", field: "isMetroCity", type: "boolean", example: "Y", note: "Y if the employee is based in Delhi, Mumbai, Kolkata or Chennai - raises the HRA exemption limit to 50% of Basic (40% for non-metro). Declared per financial year like the rent details below, since it only matters for the HRA exemption calculation." },
      { header: "Monthly Rent", field: "monthlyRent", type: "number", example: 20000 },
      { header: "Rent Start Date", field: "rentStartDate", type: "date", example: "2026-04-01" },
      { header: "Rent End Date", field: "rentEndDate", type: "date", example: "" },
      { header: "Rental Address", field: "rentalAddress", type: "string", example: "" },
      { header: "Landlord Name", field: "landlordName", type: "string", example: "" },
      { header: "Landlord PAN", field: "landlordPan", type: "string", example: "" },
      { header: "LIC Premium", field: "lic", type: "number", example: 0, limit: "Sec 123 (old 80C): Rs 1,50,000 combined with the other 80C/80CCC/80CCD(1) rows below" },
      { header: "EPF (Voluntary)", field: "epf", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "PPF", field: "ppf", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "ELSS", field: "elss", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "Life Insurance Premium", field: "lifeInsurance", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "Tuition Fees", field: "tuitionFees", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit; max 2 children" },
      { header: "Housing Loan Principal", field: "housingLoanPrincipal", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "Other 80C", field: "otherSection80C", type: "number", example: 0, limit: "Sec 123 (old 80C): same Rs 1,50,000 combined limit" },
      { header: "80CCC Pension Fund", field: "section80CCC", type: "number", example: 0, limit: "Sec 123 (old 80CCC): same Rs 1,50,000 combined limit" },
      { header: "80CCD(1) NPS Employee", field: "section80CCD1", type: "number", example: 0, limit: "Sec 123 (old 80CCD(1)): same Rs 1,50,000 combined limit" },
      { header: "80CCD(1B) Additional NPS", field: "section80CCD1B", type: "number", example: 0, limit: "Sec 124 (old 80CCD(1B)): Rs 50,000, on top of the Rs 1,50,000 80C ceiling above" },
      { header: "80D Self/Family (below 60)", field: "section80DSelfBelow60", type: "number", example: 0, limit: "Sec 126 (old 80D): Rs 25,000 (incl. up to Rs 5,000 preventive checkup, not additional)" },
      { header: "80D Self/Family (60+)", field: "section80DSelfAbove60", type: "number", example: 0, limit: "Sec 126 (old 80D): Rs 50,000 (incl. up to Rs 5,000 preventive checkup, not additional)" },
      { header: "80D Parents (below 60)", field: "section80DParentsBelow60", type: "number", example: 0, limit: "Sec 126 (old 80D): Rs 25,000" },
      { header: "80D Parents (60+)", field: "section80DParentsAbove60", type: "number", example: 0, limit: "Sec 126 (old 80D): Rs 50,000" },
      { header: "80E Education Loan Interest", field: "section80E", type: "number", example: 0, limit: "Sec 129 (old 80E): no upper limit - full interest, for 8 years from first repayment" },
      { header: "80EE Home Loan Interest", field: "section80EE", type: "number", example: 0, limit: "Sec 130 (old 80EE): Rs 50,000 (first-time buyers, specific conditions)" },
      { header: "80EEA Home Loan Interest", field: "section80EEA", type: "number", example: 0, limit: "Sec 131 (old 80EEA): Rs 1,50,000 (only loans sanctioned 1 Apr 2019 - 31 Mar 2022)" },
      { header: "80U Self Disability (<80%)", field: "section80UBelow80", type: "number", example: 0, limit: "Sec 154 (old 80U): Rs 75,000" },
      { header: "80U Self Disability (80%+)", field: "section80U80AndAbove", type: "number", example: 0, limit: "Sec 154 (old 80U): Rs 1,25,000" },
      { header: "80DD Dependent Disability (<80%)", field: "section80DDBelow80", type: "number", example: 0, limit: "Sec 127 (old 80DD): Rs 75,000" },
      { header: "80DD Dependent Disability (80%+)", field: "section80DD80AndAbove", type: "number", example: 0, limit: "Sec 127 (old 80DD): Rs 1,25,000" },
      { header: "80G Donations", field: "donations80G", type: "number", example: 0, limit: "Sec 133 (old 80G): 50% or 100% of donated amount depending on institution, some capped at 10% of adjusted gross income - enter the employee's own already-computed eligible amount" },
      { header: "LTA Exempt Amount", field: "ltaClaimed", type: "number", example: 0, limit: "Old Sec 10(5), new Act number not independently verified: limited to actual eligible travel cost, 2 journeys per 4-calendar-year block (current block 2026-2029) - not a flat cap" },
      { header: "Home Loan Interest (Self-Occupied)", field: "homeLoanInterestSelfOccupied", type: "number", example: 0, limit: "Sec 24(b) (unchanged): Rs 2,00,000" },
      { header: "Let-Out: Annual Value", field: "letOutAnnualValue", type: "number", example: 0, limit: "-" },
      { header: "Let-Out: Municipal Tax", field: "letOutMunicipalTax", type: "number", example: 0, limit: "-" },
      { header: "Let-Out: Home Loan Interest", field: "letOutHomeLoanInterest", type: "number", example: 0, limit: "Old Sec 71(3A), new Act number not independently verified: house property loss set-off (self-occupied + let-out combined) capped at Rs 2,00,000/year against other income" },
      { header: "Other Eligible Deductions", field: "otherDeductions", type: "number", example: 0, limit: "No limit modeled - use only for a deduction not covered by any column above" },
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
      { header: "Legal Entity", field: "companyId", type: "string", example: "My Company Pvt Ltd", note: "Only needed in a multi-entity setup if the same Employee Code happens to exist under more than one company - otherwise leave blank. Must match a company name from Setup > Companies." },
      { header: "Payroll Month", field: "payrollMonth", required: true, type: "string", example: "April" },
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

const INSTRUCTIONS_LINES = [
  "Payroll Register - Setup & Usage Guide",
  "",
  "This one workbook has 4 data tabs (Employee Master, Salary Structure, Investment Declaration, Previous Employer), this Instructions tab, and 'Employee - Field Guide' / 'Investment - Field Guide' tabs documenting every column on those two tabs, including the Employee Master override flags (PF/ESI/Professional Tax Applicable, State) and Investment Declaration's statutory maximums. Columns marked with * are mandatory.",
  "",
  "TIP: For just ONE employee, you don't need Excel at all - in the app, go to Employees > + Add Employee, then fill in Salary Structure / Investment Declaration / Previous Employer directly on that employee's page. Use this workbook only when adding many employees at once.",
  "",
  "MULTI-ENTITY SETUP: Running more than one legal entity (Company) in this app? Only the 'Employee Master' tab has a 'Legal Entity' column - it decides which company the employee is created under. You don't need to set the company up first: a name that doesn't already exist under Setup > Companies is created automatically from this column (just the name - add PAN/TAN/bank details there afterwards); a name that matches an existing company reuses it. Leave it blank on any row to use whichever company is active in the app (topbar switcher) at import time. The other 3 tabs (Salary Structure, Investment Declaration, Previous Employer) find each employee purely from their Employee Code, which already carries their Legal Entity from Employee Master - nothing extra to fill in there, unless you reuse the exact same Employee Code in two different companies, in which case give them unique codes instead.",
  "",
  "STEP 1 - Fill in your data in this workbook",
  "1. Go to the 'Employee Master' tab. Enter one row per employee. Employee Code is whatever short code you want to use (e.g. EMP101) - you'll reuse it on the other tabs. Set State (matching a state from the PT Slabs screen) if Professional Tax should be auto-calculated from that state's slabs every month; leave State and Professional Tax Applicable blank/N if you'd rather enter a fixed PT figure directly in the Salary Structure tab instead. PF/ESI Applicable are per-employee overrides - set to N to exempt one employee from PF/ESI even though the Salary Structure tab (or a Salary Structure Template used in-app) has a PF/ESI line for everyone else. See the 'Employee - Field Guide' tab for details on every column.",
  "2. Go to the 'Salary Structure' tab. Enter each employee's MONTHLY amount for each salary component for the current financial year - every column here is a RECURRING monthly figure, paid every month for as long as this structure is active, so never put a one-time/annual bonus in here (see 'Monthly variable pay' below instead). Employee Code must match the Employee Master tab exactly. (If you've set up a Salary Structure Template in-app under Setup > Salary Structure Templates, you can instead open each employee's page after import and generate their structure from just a CTC figure - this Excel tab only takes already-worked-out monthly amounts.)",
  "3. Go to the 'Investment Declaration' tab for employees who have tax-saving investments, medical insurance, home loan interest, or HRA rent to declare. Employee Code must match. Set Metro City (Y/N) here too - it only affects the HRA exemption calculated on this tab, re-declared each financial year alongside rent. Each 80C/80D/etc. item has its own column (not one lump '80C' figure) so the app can apply the correct statutory cap per head - see the 'Investment - Field Guide' tab for what each column means and its current maximum. If rent is only paid for part of the year, fill in Rent Start Date (and Rent End Date if it stopped before the FY ended) so HRA exemption is only computed for those months.",
  "4. Go to the 'Previous Employer' tab ONLY for employees who joined partway through this financial year and have salary/TDS from a previous employer in the same year.",
  "5. Save this file when done.",
  "",
  "STEP 2 - Import this file into the app",
  "6. In the app, open 'Import Wizard' from the left-hand menu.",
  "7. Choose 'Combined Setup Template', click 'Upload & Import', and select this saved file.",
  "8. Check the Import Summary: it shows how many rows were imported and lists any errors with the row number and tab they came from. Fix those rows in this file and re-upload if needed.",
  "9. If you re-upload after only fixing a few rows, you'll see 'already exists' errors for employees that were already imported successfully the first time - that's expected, only the fixed/new rows need to succeed.",
  "",
  "STEP 3 - Process monthly payroll",
  "10. Open 'Payroll Runs' from the left-hand menu.",
  "11. Choose the Payroll Month and click 'Create Run'.",
  "12. Click 'Run Calculation'. This works out gross salary, PF/ESI/PT, TDS under BOTH the Old and New tax regimes, and net salary for every employee.",
  "13. Click 'Details' on any employee's row to see the full tax working, and 'Regime Comparison' on their profile for the Old vs New picture.",
  "14. Once you're satisfied with the numbers, move the run forward using the button at the top: Reviewed -> Approved -> Locked -> Paid. Once Locked, further changes must go through an audited Manual Adjustment (with a reason and your name recorded) rather than a silent edit.",
  "",
  "STEP 4 - Generate outputs",
  "15. 'Salary Register' - the full month's payroll in one table, exportable to CSV.",
  "16. 'Bank Payment File' - the list to hand to your bank for salary transfer, with account/IFSC checks and a choice of bank-specific column formats.",
  "17. 'Salary Slips' - open any employee's line and click 'Slip' to view or print/save as PDF.",
  "",
  "STEP 5 - Full & Final settlement (F&F) for an employee who is leaving",
  "18. Open the employee's record under 'Employees', click 'Edit Profile', enter their 'Date of Leaving', and save.",
  "19. Create/open the payroll run for their last working month as usual and click 'Run Calculation'. The app automatically settles their ENTIRE remaining annual TDS in this final month instead of spreading it over the rest of the year.",
  "20. Add any final-settlement items (leave encashment, gratuity, notice-pay recovery, etc.) as a Manual Adjustment on their payroll line, with a reason recorded.",
  "21. Move that run through Reviewed -> Approved -> Locked -> Paid as usual, then include them in that month's Salary Register, Bank Payment File, and Salary Slip.",
  "",
  "Monthly variable pay (optional)",
  "22. For LOP (Loss of Pay) days or one-off pay like bonus/incentive/overtime/arrears in a specific month, use the separate 'Monthly Payroll Input' template instead of this workbook.",
];

function displayHeader(c) {
  return c.required ? `${c.header} *` : c.header;
}

function buildDataSheet(spec) {
  const headers = spec.columns.map(displayHeader);
  const exampleRow = spec.columns.map((c) => (c.example !== undefined ? c.example : ""));
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  return ws;
}

function buildFieldReferenceSheet(columns) {
  const hasLimits = columns.some((c) => c.limit);
  const header = hasLimits ? ["Column", "Required", "Type", "Notes", "Maximum (old regime)"] : ["Column", "Required", "Type", "Notes"];
  const ws = XLSX.utils.aoa_to_sheet([
    header,
    ...columns.map((c) => {
      const typeHint = c.type === "enum" ? `One of: ${c.enumValues.join(", ")}` : c.type === "boolean" ? "Y/N/Yes/No/True/False" : c.type === "date" ? "YYYY-MM-DD" : "";
      const row = [
        c.header,
        c.required ? "Yes (marked with * in the data tab)" : "No",
        c.type === "enum" ? `One of: ${c.enumValues.join(", ")}` : c.type,
        c.note ? `${c.note}${typeHint ? ` (${typeHint})` : ""}` : typeHint,
      ];
      if (hasLimits) row.push(c.limit || "-");
      return row;
    }),
  ]);
  ws["!cols"] = hasLimits ? [{ wch: 32 }, { wch: 30 }, { wch: 10 }, { wch: 22 }, { wch: 70 }] : [{ wch: 28 }, { wch: 30 }, { wch: 24 }, { wch: 60 }];
  return ws;
}

function buildInstructionsSheet() {
  const ws = XLSX.utils.aoa_to_sheet(INSTRUCTIONS_LINES.map((line) => [line]));
  ws["!cols"] = [{ wch: 110 }];
  return ws;
}

function buildTemplateWorkbook(type) {
  const spec = IMPORT_TEMPLATES[type];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildDataSheet(spec), spec.sheetName.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, buildFieldReferenceSheet(spec.columns), "Field Reference");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function buildCombinedTemplateWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildInstructionsSheet(), "Instructions");
  for (const type of ["EMPLOYEE", "SALARY_STRUCTURE", "INVESTMENT", "PREVIOUS_EMPLOYER"]) {
    const spec = IMPORT_TEMPLATES[type];
    XLSX.utils.book_append_sheet(wb, buildDataSheet(spec), spec.sheetName.slice(0, 31));
  }
  // The Investment Declaration tab has many columns with statutory maximums
  // (Sec 80C/80D/80DD/80U/etc.), and the Employee Master tab has several
  // override flags (PF/ESI/PT Applicable, State) whose behavior isn't
  // obvious from the column header alone - both worth their own reference
  // sheet even in the combined workbook.
  XLSX.utils.book_append_sheet(wb, buildFieldReferenceSheet(IMPORT_TEMPLATES.EMPLOYEE.columns), "Employee - Field Guide");
  XLSX.utils.book_append_sheet(wb, buildFieldReferenceSheet(IMPORT_TEMPLATES.INVESTMENT.columns), "Investment - Field Guide");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function normalizeKey(key) {
  return key.replace(/\s*\*\s*$/, "").trim();
}

function parseWorkbookRows(arrayBuffer, sheetName) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), v])));
}

function downloadWorkbook(filename, arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Revoking the blob URL immediately can race with the browser actually
  // starting the download in some embedded/sandboxed contexts - give it a
  // moment first.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

const IMPORT_PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IMPORT_IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function toBoolI(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return ["y", "yes", "true", "1"].includes(s);
}
function toNumberI(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function toDateOrNullI(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
/**
 * Resolves which Company (legal entity) a data row belongs to, from its
 * optional "Legal Entity" column - falling back to the default (the company
 * active in the app when the import was run) if left blank, so single-entity
 * users see no change in behavior. A name that doesn't match any existing
 * company is auto-created (name only - PAN/TAN/bank details can be filled in
 * later under Setup > Companies), rather than rejecting the whole row: the
 * point of naming a Legal Entity on this sheet is to set up that company via
 * the import, not to require it to already exist first. Later rows naming
 * the same new company reuse it rather than creating a duplicate.
 */
function resolveRowCompanyId(db, row, defaultCompanyId, rowErrors) {
  const entityInput = String(row["Legal Entity"] ?? "").trim();
  if (!entityInput) return defaultCompanyId;
  const match = db.companies.find((c) => c.name.trim().toLowerCase() === entityInput.toLowerCase());
  if (match) return match.id;
  const created = {
    id: newId("co"), name: entityInput, address: null, pan: null, tan: null,
    bankName: null, bankAccountNo: null, bankIfsc: null, isActive: true, createdAt: new Date().toISOString(),
  };
  db.companies.push(created);
  return created.id;
}
/**
 * Finds an already-imported employee by Employee Code for a data row on the
 * Salary Structure / Investment Declaration / Previous Employer / Monthly
 * Payroll Input sheets. The employee's own Legal Entity (set on Employee
 * Master) already fixes which company they belong to, so the common case -
 * no two companies happen to reuse the same Employee Code - needs nothing
 * extra here: the right employee is found automatically regardless of which
 * company is active in the app. Only Monthly Payroll Input still carries its
 * own optional "Legal Entity" column, consulted solely to break a tie if the
 * code genuinely exists in more than one company; the other 3 sheets have no
 * such column; see the catch-all error below for that case.
 */
function resolveEmployeeForRow(db, row, employeeCode, rowErrors) {
  const entityInput = String(row["Legal Entity"] ?? "").trim();
  if (entityInput) {
    const match = db.companies.find((c) => c.name.trim().toLowerCase() === entityInput.toLowerCase());
    if (!match) {
      rowErrors.push(`Unrecognized Legal Entity '${entityInput}' - must match a company name exactly as set up under Setup > Companies`);
      return null;
    }
    return db.employees.find((e) => e.companyId === match.id && e.employeeCode === employeeCode) || null;
  }
  const matches = db.employees.filter((e) => e.employeeCode === employeeCode);
  if (matches.length > 1) {
    rowErrors.push(`Employee code '${employeeCode}' exists in more than one Legal Entity - give each company's employees unique Employee Codes to resolve this`);
    return null;
  }
  return matches[0] || null;
}
function requiredFieldsPresent(type, row, errors) {
  for (const col of IMPORT_TEMPLATES[type].columns) {
    if (col.required && (row[col.header] === null || row[col.header] === undefined || row[col.header] === "")) {
      errors.push(`Missing required field '${col.header}'`);
    }
  }
}

function importEmployees(db, rows, defaultCompanyId) {
  const errors = [];
  let imported = 0;
  const seenCodes = new Set();
  const seenPans = new Set();
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    requiredFieldsPresent("EMPLOYEE", row, rowErrors);
    const companyId = resolveRowCompanyId(db, row, defaultCompanyId, rowErrors);

    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const pan = String(row["PAN"] ?? "").trim().toUpperCase() || null;
    const dedupeCodeKey = `${companyId}:${employeeCode}`;
    const dedupePanKey = `${companyId}:${pan}`;
    if (employeeCode) {
      if (seenCodes.has(dedupeCodeKey)) rowErrors.push(`Duplicate employee code '${employeeCode}' within this file (for this Legal Entity)`);
      seenCodes.add(dedupeCodeKey);
      if (db.employees.some((e) => e.companyId === companyId && e.employeeCode === employeeCode)) rowErrors.push(`Employee code '${employeeCode}' already exists in this company`);
    }
    if (pan) {
      if (!IMPORT_PAN_REGEX.test(pan)) rowErrors.push(`Invalid PAN format '${pan}'`);
      if (seenPans.has(dedupePanKey)) rowErrors.push(`Duplicate PAN '${pan}' within this file (for this Legal Entity)`);
      seenPans.add(dedupePanKey);
      if (db.employees.some((e) => e.companyId === companyId && e.pan === pan)) rowErrors.push(`PAN '${pan}' already used by another employee in this company`);
    }
    const dateOfJoining = toDateOrNullI(row["Date of Joining"]);
    if (row["Date of Joining"] && !dateOfJoining) rowErrors.push("Invalid Date of Joining");
    const ifsc = String(row["IFSC"] ?? "").trim().toUpperCase() || null;
    if (ifsc && !IMPORT_IFSC_REGEX.test(ifsc)) rowErrors.push(`Invalid IFSC format '${ifsc}'`);
    const taxRegime = String(row["Tax Regime"] ?? "NEW").trim().toUpperCase() || "NEW";
    if (!["OLD", "NEW"].includes(taxRegime)) rowErrors.push(`Invalid tax regime '${taxRegime}' (must be OLD or NEW)`);
    const stateInput = String(row["State"] ?? "").trim();
    let stateKey = null;
    if (stateInput) {
      const match = db.ptSlabs.find((s) => s.key.toLowerCase() === stateInput.toLowerCase() || s.label.toLowerCase() === stateInput.toLowerCase());
      if (!match) rowErrors.push(`Unrecognized State '${stateInput}' - must match a state name from the PT Slabs screen (e.g. Maharashtra, Karnataka, Delhi)`);
      else stateKey = match.key;
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    db.employees.push({
      id: newId("emp"), companyId, employeeCode, fullName: String(row["Employee Name"] ?? "").trim(), pan,
      dob: toDateOrNullI(row["DOB"]), gender: row["Gender"] ? String(row["Gender"]) : null,
      aadhaar: null, email: null, phone: null,
      dateOfJoining, dateOfLeaving: null,
      department: row["Department"] ? String(row["Department"]) : null,
      designation: row["Designation"] ? String(row["Designation"]) : null,
      location: row["Location"] ? String(row["Location"]) : null,
      state: stateKey,
      costCentre: null, payrollGroup: null,
      bankName: row["Bank Name"] ? String(row["Bank Name"]) : null,
      bankAccountNo: row["Account Number"] ? String(row["Account Number"]) : null,
      bankIfsc: ifsc,
      uan: row["UAN"] ? String(row["UAN"]) : null,
      pfApplicable: toBoolI(row["PF Applicable"] ?? "Y"),
      esiApplicable: toBoolI(row["ESI Applicable"] ?? "N"),
      ptApplicable: toBoolI(row["Professional Tax Applicable"] ?? (stateKey ? "Y" : "N")),
      taxRegime, ageCategory: "BELOW_60", status: "ACTIVE",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    imported++;
  }
  return { imported, errors };
}

function importSalaryStructures(db, rows) {
  const errors = [];
  let imported = 0;
  const fy = db.financialYears.find((f) => f.isCurrent);
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");
  const numericFields = IMPORT_TEMPLATES.SALARY_STRUCTURE.columns.filter((c) => c.type === "number");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    const employee = employeeCode ? resolveEmployeeForRow(db, row, employeeCode, rowErrors) : null;
    if (employeeCode && rowErrors.length === 0 && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const amounts = [];
    for (const col of numericFields) {
      const monthly = toNumberI(row[col.header]);
      if (Number.isNaN(monthly)) rowErrors.push(`Invalid number for '${col.header}'`);
      else if (monthly < 0) rowErrors.push(`'${col.header}' cannot be negative`);
      else if (monthly > 0) amounts.push({ code: col.field, monthly });
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const annualCTC = amounts.reduce((s, a) => s + a.monthly * 12, 0);
    const now = new Date().toISOString();
    // Effective from the FY's start (not "now", the moment of import) - an
    // admin setting up a new financial year's payroll in bulk is almost
    // always doing so after that FY has already started, and every month
    // between the FY start and the import date would otherwise have no
    // active structure, failing "Run Calculation" with "No active salary
    // structure" for each of those months.
    const effectiveFrom = fy.startDate;
    for (const s of db.employeeSalaryStructures) {
      if (s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive) {
        s.isActive = false;
        s.effectiveTo = now;
      }
    }
    db.employeeSalaryStructures.push({
      id: newId("ess"), employeeId: employee.id, financialYearId: fy.id, annualCTC, effectiveFrom, effectiveTo: null, isActive: true, createdAt: now,
      components: amounts.map((a) => {
        const comp = db.salaryComponents.find((c) => c.code === a.code);
        return { componentId: comp.id, componentCode: a.code, category: comp.category, monthlyAmount: a.monthly, annualAmount: a.monthly * 12, formulaUsed: `Imported fixed monthly amount: Rs ${a.monthly.toLocaleString("en-IN")}/month` };
      }),
    });
    imported++;
  }
  return { imported, errors };
}

function importInvestmentDeclarations(db, rows) {
  const errors = [];
  let imported = 0;
  const fy = db.financialYears.find((f) => f.isCurrent);
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? resolveEmployeeForRow(db, row, employeeCode, rowErrors) : null;
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (rowErrors.length === 0 && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const regime = String(row["Tax Regime"] ?? (employee ? employee.taxRegime : "NEW") ?? "NEW").toUpperCase();
    if (regime && !["OLD", "NEW"].includes(regime)) rowErrors.push(`Invalid tax regime '${regime}'`);

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    if (regime !== employee.taxRegime) employee.taxRegime = regime;

    const values = {
      isMetroCity: toBoolI(row["Metro City (Y/N)"] ?? "N"),
      monthlyRent: toNumberI(row["Monthly Rent"]),
      rentStartDate: toDateOrNullI(row["Rent Start Date"]),
      rentEndDate: toDateOrNullI(row["Rent End Date"]),
      rentalAddress: String(row["Rental Address"] ?? "").trim() || null,
      landlordName: String(row["Landlord Name"] ?? "").trim() || null,
      landlordPan: String(row["Landlord PAN"] ?? "").trim() || null,
      lic: toNumberI(row["LIC Premium"]),
      epf: toNumberI(row["EPF (Voluntary)"]),
      ppf: toNumberI(row["PPF"]),
      elss: toNumberI(row["ELSS"]),
      lifeInsurance: toNumberI(row["Life Insurance Premium"]),
      tuitionFees: toNumberI(row["Tuition Fees"]),
      housingLoanPrincipal: toNumberI(row["Housing Loan Principal"]),
      otherSection80C: toNumberI(row["Other 80C"]),
      section80CCC: toNumberI(row["80CCC Pension Fund"]),
      section80CCD1: toNumberI(row["80CCD(1) NPS Employee"]),
      section80CCD1B: toNumberI(row["80CCD(1B) Additional NPS"]),
      section80DSelfBelow60: toNumberI(row["80D Self/Family (below 60)"]),
      section80DSelfAbove60: toNumberI(row["80D Self/Family (60+)"]),
      section80DParentsBelow60: toNumberI(row["80D Parents (below 60)"]),
      section80DParentsAbove60: toNumberI(row["80D Parents (60+)"]),
      section80E: toNumberI(row["Education Loan Interest"] ?? row["80E Education Loan Interest"]),
      section80EE: toNumberI(row["80EE Home Loan Interest"]),
      section80EEA: toNumberI(row["80EEA Home Loan Interest"]),
      section80UBelow80: toNumberI(row["80U Self Disability (<80%)"]),
      section80U80AndAbove: toNumberI(row["80U Self Disability (80%+)"]),
      section80DDBelow80: toNumberI(row["80DD Dependent Disability (<80%)"]),
      section80DD80AndAbove: toNumberI(row["80DD Dependent Disability (80%+)"]),
      donations80G: toNumberI(row["80G Donations"] ?? row["Donations"]),
      ltaClaimed: toNumberI(row["LTA Exempt Amount"] ?? row["LTA"]),
      homeLoanInterestSelfOccupied: toNumberI(row["Home Loan Interest (Self-Occupied)"] ?? row["Home Loan Interest"]),
      letOutAnnualValue: toNumberI(row["Let-Out: Annual Value"]),
      letOutMunicipalTax: toNumberI(row["Let-Out: Municipal Tax"]),
      letOutHomeLoanInterest: toNumberI(row["Let-Out: Home Loan Interest"]),
      otherDeductions: toNumberI(row["Other Eligible Deductions"]),
    };
    const existing = db.investmentDeclarations.find((d) => d.employeeId === employee.id && d.financialYearId === fy.id);
    if (existing) Object.assign(existing, values, { updatedAt: new Date().toISOString() });
    else db.investmentDeclarations.push({ id: newId("inv"), employeeId: employee.id, financialYearId: fy.id, proofStatus: "PENDING", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...values });
    imported++;
  }
  return { imported, errors };
}

function importPreviousEmployer(db, rows) {
  const errors = [];
  let imported = 0;
  const fy = db.financialYears.find((f) => f.isCurrent);
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    requiredFieldsPresent("PREVIOUS_EMPLOYER", row, rowErrors);
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? resolveEmployeeForRow(db, row, employeeCode, rowErrors) : null;
    if (employeeCode && rowErrors.length === 0 && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);
    const grossSalary = toNumberI(row["Salary"]);
    const taxableSalary = toNumberI(row["Taxable Salary"]);
    if (grossSalary < 0 || taxableSalary < 0) rowErrors.push("Salary figures cannot be negative");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    db.previousEmployerIncomes.push({
      id: newId("pei"), employeeId: employee.id, financialYearId: fy.id,
      employerName: String(row["Previous Employer"]),
      periodFrom: fy.startDate,
      periodTo: employee.dateOfJoining < fy.endDate ? employee.dateOfJoining : fy.startDate,
      grossSalary, taxableSalary, exemptions: toNumberI(row["Exemptions"]), deductions: toNumberI(row["Deductions"]), tdsDeducted: toNumberI(row["TDS"]), pfDeducted: 0, notes: null,
      createdAt: new Date().toISOString(),
    });
    imported++;
  }
  return { imported, errors };
}

function importMonthlyPayroll(db, rows) {
  const errors = [];
  let imported = 0;
  const fy = db.financialYears.find((f) => f.isCurrent);
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");
  // Maps each template column to the taxable salary-component code it feeds
  // into run.overrides[employeeId].variablePay - these are real taxable
  // earnings for the month (same path as the on-screen "LOP & Bonus" editor),
  // NOT post-tax Manual Adjustments, so they correctly affect gross/TDS.
  const VARIABLE_FIELDS = [["Bonus", "BONUS"], ["Incentive", "INCENTIVE"], ["Overtime", "OVERTIME"], ["Arrears", "ARREARS"], ["Other Earnings", "OTHER_ALLOWANCE"]];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = employeeCode ? resolveEmployeeForRow(db, row, employeeCode, rowErrors) : null;
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (rowErrors.length === 0 && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const monthName = String(row["Payroll Month"] ?? "").trim();
    const monthIndex = FY_MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName.toLowerCase()) + 1;
    if (monthIndex === 0) rowErrors.push(`Invalid Payroll Month '${monthName}' (use April, May, ... March)`);

    const lopDays = toNumberI(row["LOP Days"]);
    if (Number.isNaN(lopDays) || lopDays < 0) rowErrors.push("LOP Days must be a non-negative number");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const run = db.payrollRuns.find((r) => r.companyId === employee.companyId && r.financialYearId === fy.id && r.payrollMonthIndex === monthIndex && !r.payrollGroup);
    if (!run) {
      errors.push({ rowNumber, message: `No payroll run exists yet for ${monthName} ${fy.code}. Create it first, then re-import.` });
      continue;
    }
    if (run.status === "LOCKED" || run.status === "PAID") {
      errors.push({ rowNumber, message: `Payroll run for ${monthName} ${fy.code} is ${run.status}; apply changes via an adjustment instead.` });
      continue;
    }

    try {
      const variablePay = {};
      for (const [header, code] of VARIABLE_FIELDS) {
        const amt = toNumberI(row[header]);
        if (amt) variablePay[code] = (variablePay[code] || 0) + amt;
      }
      if (!run.overrides) run.overrides = {};
      if (lopDays || Object.keys(variablePay).length) run.overrides[employee.id] = { lopDays, variablePay };
      const line = PayrollEngine.recalculateLine(db, run.id, employee.id);

      const otherDed = toNumberI(row["Other Deductions"]);
      if (otherDed) PayrollEngine.addAdjustment(db, line.id, { amount: -otherDed, reason: "Imported monthly input: Other Deductions", enteredBy: "Import Wizard" });
      imported++;
    } catch (err) {
      errors.push({ rowNumber, message: err.message });
    }
  }
  return { imported, errors };
}

function runSingleImport(db, type, arrayBuffer, fileName, companyId) {
  const rows = parseWorkbookRows(arrayBuffer, IMPORT_TEMPLATES[type].sheetName);
  const runners = { EMPLOYEE: importEmployees, SALARY_STRUCTURE: importSalaryStructures, INVESTMENT: importInvestmentDeclarations, PREVIOUS_EMPLOYER: importPreviousEmployer, MONTHLY_PAYROLL: importMonthlyPayroll };
  const result = runners[type](db, rows, companyId);
  const batch = {
    id: newId("imp"), templateType: type, fileName, totalRecords: rows.length, importedRecords: result.imported, failedRecords: result.errors.length,
    status: result.errors.length === 0 ? "COMPLETED" : result.imported === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS",
    errors: result.errors, createdAt: new Date().toISOString(),
  };
  db.importBatches.push(batch);
  return batch;
}

function runCombinedImport(db, arrayBuffer, fileName, companyId) {
  const sections = [
    ["EMPLOYEE", "Employee Master", importEmployees],
    ["SALARY_STRUCTURE", "Salary Structure", importSalaryStructures],
    ["INVESTMENT", "Investment Declaration", importInvestmentDeclarations],
    ["PREVIOUS_EMPLOYER", "Previous Employer", importPreviousEmployer],
  ];
  let totalRecords = 0, imported = 0;
  const errors = [];
  for (const [type, label, run] of sections) {
    const rows = parseWorkbookRows(arrayBuffer, IMPORT_TEMPLATES[type].sheetName);
    totalRecords += rows.length;
    const result = run(db, rows, companyId);
    imported += result.imported;
    for (const e of result.errors) errors.push({ rowNumber: e.rowNumber, message: `[${label}] ${e.message}` });
  }
  const batch = {
    id: newId("imp"), templateType: "COMBINED", fileName, totalRecords, importedRecords: imported, failedRecords: errors.length,
    status: errors.length === 0 ? "COMPLETED" : imported === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS",
    errors, createdAt: new Date().toISOString(),
  };
  db.importBatches.push(batch);
  return batch;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { IMPORT_TEMPLATES, INSTRUCTIONS_LINES, buildTemplateWorkbook, buildCombinedTemplateWorkbook, parseWorkbookRows, runSingleImport, runCombinedImport };
}
