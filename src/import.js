// Import Wizard logic - ported from lib/import/{spec,excel,instructions,run-import}.ts.
// Uses the vendored SheetJS build (vendor/xlsx.full.min.js, loaded as the
// global `XLSX`) to read/write .xlsx files entirely client-side.

const IMPORT_TEMPLATES = {
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
  "This one workbook has 4 data tabs (Employee Master, Salary Structure, Investment Declaration, Previous Employer) plus this Instructions tab. Columns marked with * are mandatory.",
  "",
  "TIP: For just ONE employee, you don't need Excel at all - in the app, go to Employees > + Add Employee, then fill in Salary Structure / Investment Declaration / Previous Employer directly on that employee's page. Use this workbook only when adding many employees at once.",
  "",
  "STEP 1 - Fill in your data in this workbook",
  "1. Go to the 'Employee Master' tab. Enter one row per employee. Employee Code is whatever short code you want to use (e.g. EMP101) - you'll reuse it on the other tabs.",
  "2. Go to the 'Salary Structure' tab. Enter each employee's ANNUAL amount for each salary component for the current financial year. Employee Code must match the Employee Master tab exactly.",
  "3. Go to the 'Investment Declaration' tab for employees who have tax-saving investments, medical insurance, home loan interest, or HRA rent to declare. Employee Code must match.",
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
  const ws = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Type", "Notes"],
    ...columns.map((c) => [
      c.header,
      c.required ? "Yes (marked with * in the data tab)" : "No",
      c.type === "enum" ? `One of: ${c.enumValues.join(", ")}` : c.type,
      c.type === "boolean" ? "Y/N/Yes/No/True/False" : c.type === "date" ? "YYYY-MM-DD" : "",
    ]),
  ]);
  ws["!cols"] = [{ wch: 28 }, { wch: 30 }, { wch: 24 }, { wch: 30 }];
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
function requiredFieldsPresent(type, row, errors) {
  for (const col of IMPORT_TEMPLATES[type].columns) {
    if (col.required && (row[col.header] === null || row[col.header] === undefined || row[col.header] === "")) {
      errors.push(`Missing required field '${col.header}'`);
    }
  }
}

function importEmployees(db, rows, companyId) {
  const errors = [];
  let imported = 0;
  const seenCodes = new Set();
  const seenPans = new Set();
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    requiredFieldsPresent("EMPLOYEE", row, rowErrors);

    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const pan = String(row["PAN"] ?? "").trim().toUpperCase() || null;
    if (employeeCode) {
      if (seenCodes.has(employeeCode)) rowErrors.push(`Duplicate employee code '${employeeCode}' within this file`);
      seenCodes.add(employeeCode);
      if (db.employees.some((e) => e.companyId === companyId && e.employeeCode === employeeCode)) rowErrors.push(`Employee code '${employeeCode}' already exists in this company`);
    }
    if (pan) {
      if (!IMPORT_PAN_REGEX.test(pan)) rowErrors.push(`Invalid PAN format '${pan}'`);
      if (seenPans.has(pan)) rowErrors.push(`Duplicate PAN '${pan}' within this file`);
      seenPans.add(pan);
      if (db.employees.some((e) => e.companyId === companyId && e.pan === pan)) rowErrors.push(`PAN '${pan}' already used by another employee in this company`);
    }
    const dateOfJoining = toDateOrNullI(row["Date of Joining"]);
    if (row["Date of Joining"] && !dateOfJoining) rowErrors.push("Invalid Date of Joining");
    const ifsc = String(row["IFSC"] ?? "").trim().toUpperCase() || null;
    if (ifsc && !IMPORT_IFSC_REGEX.test(ifsc)) rowErrors.push(`Invalid IFSC format '${ifsc}'`);
    const taxRegime = String(row["Tax Regime"] ?? "NEW").trim().toUpperCase() || "NEW";
    if (!["OLD", "NEW"].includes(taxRegime)) rowErrors.push(`Invalid tax regime '${taxRegime}' (must be OLD or NEW)`);

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
      costCentre: null, payrollGroup: null,
      bankName: row["Bank Name"] ? String(row["Bank Name"]) : null,
      bankAccountNo: row["Account Number"] ? String(row["Account Number"]) : null,
      bankIfsc: ifsc,
      uan: row["UAN"] ? String(row["UAN"]) : null,
      pfApplicable: toBoolI(row["PF Applicable"] ?? "Y"),
      esiApplicable: toBoolI(row["ESI Applicable"] ?? "N"),
      ptApplicable: toBoolI(row["Professional Tax Applicable"] ?? "Y"),
      taxRegime, ageCategory: "BELOW_60", status: "ACTIVE", isMetroCity: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    imported++;
  }
  return { imported, errors };
}

function importSalaryStructures(db, rows, companyId) {
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
    const employee = db.employees.find((e) => e.companyId === companyId && e.employeeCode === employeeCode);
    if (employeeCode && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const amounts = [];
    for (const col of numericFields) {
      const annual = toNumberI(row[col.header]);
      if (Number.isNaN(annual)) rowErrors.push(`Invalid number for '${col.header}'`);
      else if (annual < 0) rowErrors.push(`'${col.header}' cannot be negative`);
      else if (annual > 0) amounts.push({ code: col.field, monthly: Math.round((annual / 12) * 100) / 100, annual });
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const annualCTC = amounts.reduce((s, a) => s + a.monthly * 12, 0);
    const now = new Date().toISOString();
    for (const s of db.employeeSalaryStructures) {
      if (s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive) {
        s.isActive = false;
        s.effectiveTo = now;
      }
    }
    db.employeeSalaryStructures.push({
      id: newId("ess"), employeeId: employee.id, financialYearId: fy.id, annualCTC, effectiveFrom: now, effectiveTo: null, isActive: true, createdAt: now,
      components: amounts.map((a) => {
        const comp = db.salaryComponents.find((c) => c.code === a.code);
        return { componentId: comp.id, componentCode: a.code, category: comp.category, monthlyAmount: a.monthly, annualAmount: a.monthly * 12, formulaUsed: `Imported fixed amount: Rs ${(a.monthly * 12).toLocaleString("en-IN")}/year` };
      }),
    });
    imported++;
  }
  return { imported, errors };
}

function importInvestmentDeclarations(db, rows, companyId) {
  const errors = [];
  let imported = 0;
  const fy = db.financialYears.find((f) => f.isCurrent);
  if (!fy) throw new Error("No financial year is marked current. Set one under Tax Rules first.");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const rowErrors = [];
    const employeeCode = String(row["Employee Code"] ?? "").trim();
    const employee = db.employees.find((e) => e.companyId === companyId && e.employeeCode === employeeCode);
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (!employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const regime = String(row["Tax Regime"] ?? (employee ? employee.taxRegime : "NEW") ?? "NEW").toUpperCase();
    if (regime && !["OLD", "NEW"].includes(regime)) rowErrors.push(`Invalid tax regime '${regime}'`);

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    if (regime !== employee.taxRegime) employee.taxRegime = regime;

    const values = {
      otherSection80C: toNumberI(row["80C"]),
      section80DSelfBelow60: toNumberI(row["80D"]),
      section80CCD1B: toNumberI(row["80CCD"]),
      homeLoanInterestSelfOccupied: toNumberI(row["Home Loan Interest"]),
      section80E: toNumberI(row["Education Loan Interest"]),
      donations80G: toNumberI(row["Donations"]),
      monthlyRent: toNumberI(row["HRA Rent"]),
      ltaClaimed: toNumberI(row["LTA"]),
      otherDeductions: toNumberI(row["Other Eligible Deductions"]),
    };
    const existing = db.investmentDeclarations.find((d) => d.employeeId === employee.id && d.financialYearId === fy.id);
    if (existing) Object.assign(existing, values, { updatedAt: new Date().toISOString() });
    else db.investmentDeclarations.push({ id: newId("inv"), employeeId: employee.id, financialYearId: fy.id, proofStatus: "PENDING", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...values });
    imported++;
  }
  return { imported, errors };
}

function importPreviousEmployer(db, rows, companyId) {
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
    const employee = db.employees.find((e) => e.companyId === companyId && e.employeeCode === employeeCode);
    if (employeeCode && !employee) rowErrors.push(`Employee code '${employeeCode}' not found`);
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

function importMonthlyPayroll(db, rows, companyId) {
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
    const employee = db.employees.find((e) => e.companyId === companyId && e.employeeCode === employeeCode);
    if (!employeeCode) rowErrors.push("Missing required field 'Employee Code'");
    else if (!employee) rowErrors.push(`Employee code '${employeeCode}' not found`);

    const monthName = String(row["Payroll Month"] ?? "").trim();
    const monthIndex = FY_MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName.toLowerCase()) + 1;
    if (monthIndex === 0) rowErrors.push(`Invalid Payroll Month '${monthName}' (use April, May, ... March)`);

    const lopDays = toNumberI(row["LOP Days"]);
    if (Number.isNaN(lopDays) || lopDays < 0) rowErrors.push("LOP Days must be a non-negative number");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, message: rowErrors.join("; ") });
      continue;
    }

    const run = db.payrollRuns.find((r) => r.companyId === companyId && r.financialYearId === fy.id && r.payrollMonthIndex === monthIndex && !r.payrollGroup);
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
