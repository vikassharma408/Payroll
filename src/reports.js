// Reports/exports logic - ported from lib/reports/salary-register.ts,
// lib/reports/index.ts, lib/reports/reconciliation.ts and lib/bank-file.ts.
// Pure functions operating on the in-memory `db`; no rendering here.

const OTHER_ALLOWANCE_CODES = ["DA", "TRANSPORT_ALLOWANCE", "MEDICAL_ALLOWANCE", "LTA", "COMMISSION", "OVERTIME", "ARREARS", "PERFORMANCE_PAY", "OTHER_ALLOWANCE", "GRATUITY_TAXABLE", "LEAVE_ENCASHMENT_TAXABLE"];
const OTHER_DEDUCTION_CODES = ["SALARY_ADVANCE", "LOAN_RECOVERY", "OTHER_DEDUCTION"];
const OTHER_EMPLOYER_CODES = ["EMPLOYER_SUPERANNUATION", "OTHER_EMPLOYER_BENEFIT"];
const IFSC_REGEX_R = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function sumCodesR(map, codes) {
  return codes.reduce((s, c) => s + (map[c] ?? 0), 0);
}

const SALARY_REGISTER_COLUMNS = [
  ["Employee Code", "employeeCode"], ["Employee Name", "employeeName"], ["PAN", "pan"], ["Department", "department"], ["Designation", "designation"],
  ["Basic", "basic"], ["HRA", "hra"], ["Special Allowance", "specialAllowance"], ["Other Allowances", "otherAllowances"], ["Bonus", "bonus"], ["Incentive", "incentive"],
  ["Gross Salary", "grossSalary"], ["Employee PF", "employeePf"], ["Employee ESI", "employeeEsi"], ["Professional Tax", "professionalTax"], ["LWF", "lwf"],
  ["Other Deductions", "otherDeductions"], ["TDS", "tds"], ["Total Deductions", "totalDeductions"], ["Net Salary", "netSalary"],
  ["Employer PF", "employerPf"], ["Employer ESI", "employerEsi"], ["Gratuity", "gratuity"], ["Total CTC / Employer Cost", "totalCtc"],
];

function getSalaryRegisterRows(db, payrollRunId) {
  const run = db.payrollRuns.find((r) => r.id === payrollRunId);
  if (!run) return [];
  return run.lines
    .slice()
    .sort((a, b) => {
      const ea = db.employees.find((e) => e.id === a.employeeId);
      const eb = db.employees.find((e) => e.id === b.employeeId);
      return (ea ? ea.employeeCode : "").localeCompare(eb ? eb.employeeCode : "");
    })
    .map((line) => {
      const e = db.employees.find((x) => x.id === line.employeeId) || {};
      const earn = line.earnings, ec = line.employerContributions, d = line.deductions;
      // A component-wise arrears top-up (e.g. "BASIC__ARREARS", posted by
      // PayrollEngine.applyArrears - must match its ARREARS_CODE_SUFFIX) is
      // its own distinct earning code, not literally "BASIC" or "ARREARS",
      // so it needs its own catch into the Other Allowances bucket to keep
      // this register's columns summing to Gross Salary.
      const arrearsTopUps = Object.entries(earn).reduce((s, [code, v]) => (code.endsWith("__ARREARS") ? s + v : s), 0);
      return {
        employeeCode: e.employeeCode || "", employeeName: e.fullName || "", pan: e.pan || "", department: e.department || "", designation: e.designation || "",
        basic: earn["BASIC"] ?? 0, hra: earn["HRA"] ?? 0, specialAllowance: earn["SPECIAL_ALLOWANCE"] ?? 0, otherAllowances: sumCodesR(earn, OTHER_ALLOWANCE_CODES) + arrearsTopUps,
        bonus: earn["BONUS"] ?? 0, incentive: earn["INCENTIVE"] ?? 0, grossSalary: line.grossSalary,
        employeePf: d["EMPLOYEE_PF"] ?? 0, employeeEsi: d["EMPLOYEE_ESI"] ?? 0, professionalTax: d["PROFESSIONAL_TAX"] ?? 0, lwf: d["LWF"] ?? 0,
        otherDeductions: sumCodesR(d, OTHER_DEDUCTION_CODES), tds: line.tdsMonthly, totalDeductions: line.totalDeductions, netSalary: line.netSalary,
        employerPf: ec["EMPLOYER_PF"] ?? 0, employerEsi: ec["EMPLOYER_ESI"] ?? 0, gratuity: ec["GRATUITY"] ?? 0, employerNps: ec["EMPLOYER_NPS"] ?? 0,
        otherEmployerCost: sumCodesR(ec, OTHER_EMPLOYER_CODES), totalCtc: line.totalEmployerCost,
      };
    });
}

// Combines the Salary Register rows of several runs (any mix of companies
// and/or months) into one export - used for "this month, every company" and
// "the whole year" exports from the Salary Register browser. Tagging columns
// are added in front so a reader can tell which row came from where once
// rows from multiple runs are mixed together in one sheet.
function buildCombinedRegisterExport(db, runs, { includeMonthColumn, includeCompanyColumn }) {
  const columns = [];
  if (includeMonthColumn) columns.push("Month");
  if (includeCompanyColumn) columns.push("Company");
  columns.push(...SALARY_REGISTER_COLUMNS.map((c) => c[0]));
  const rows = [];
  for (const run of runs) {
    const company = db.companies.find((c) => c.id === run.companyId);
    const monthTag = `${FY_MONTH_NAMES[run.payrollMonthIndex - 1].slice(0, 3)}-${String(run.calendarYear).slice(-2)}`;
    for (const r of getSalaryRegisterRows(db, run.id)) {
      const row = [];
      if (includeMonthColumn) row.push(monthTag);
      if (includeCompanyColumn) row.push(company ? company.name : "");
      row.push(...SALARY_REGISTER_COLUMNS.map((c) => r[c[1]]));
      rows.push(row);
    }
  }
  return { columns, rows };
}

function buildBankFileData(db, payrollRunId) {
  const run = db.payrollRuns.find((r) => r.id === payrollRunId);
  const fy = db.financialYears.find((f) => f.id === run.financialYearId);
  const company = db.companies.find((c) => c.id === run.companyId) || db.companies[0] || {};
  const monthLabel = `${FY_MONTH_NAMES[run.payrollMonthIndex - 1]} ${run.calendarYear}`;
  const rows = [];
  const issues = [];
  const accountsSeen = new Map();

  for (const line of run.lines) {
    const e = db.employees.find((x) => x.id === line.employeeId);
    const label = `${e.employeeCode} - ${e.fullName}`;
    if (!e.bankAccountNo) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing bank account number" });
    if (!e.bankIfsc) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing IFSC code" });
    else if (!IFSC_REGEX_R.test(e.bankIfsc)) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: `Invalid IFSC format '${e.bankIfsc}'` });
    if (e.bankAccountNo) {
      const prior = accountsSeen.get(e.bankAccountNo);
      if (prior) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: `Bank account ${e.bankAccountNo} is also used by ${prior}` });
      else accountsSeen.set(e.bankAccountNo, label);
    }
    if (line.netSalary <= 0) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: `Net salary is zero or negative (Rs ${line.netSalary})` });
    if (!e.bankName) issues.push({ employeeCode: e.employeeCode, employeeName: e.fullName, issue: "Missing bank name" });

    rows.push({
      employeeCode: e.employeeCode, employeeName: e.fullName, bankName: e.bankName || "", accountNumber: e.bankAccountNo || "", ifsc: e.bankIfsc || "",
      companyAccountNumber: company.bankAccountNo || "", netSalary: line.netSalary, paymentMonth: monthLabel,
      paymentReference: `SAL-${fy.code}-${String(run.payrollMonthIndex).padStart(2, "0")}-${e.employeeCode}`,
    });
  }
  return { run, rows, issues, monthLabel };
}

function groupSum(rows, groupField) {
  const groups = new Map();
  for (const r of rows) {
    const key = r[groupField] || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, groupRows] of groups) {
    out.push([
      key, groupRows.length,
      groupRows.reduce((s, r) => s + r.grossSalary, 0), groupRows.reduce((s, r) => s + r.totalDeductions, 0),
      groupRows.reduce((s, r) => s + r.tds, 0), groupRows.reduce((s, r) => s + r.netSalary, 0), groupRows.reduce((s, r) => s + r.totalCtc, 0),
    ]);
  }
  return out;
}

const REPORT_TYPES = [
  { key: "salary-register", label: "Monthly Salary Register", needsRun: true },
  { key: "department-wise", label: "Department-wise Payroll", needsRun: true },
  { key: "cost-centre-wise", label: "Cost Centre-wise Payroll", needsRun: true },
  { key: "tds-register", label: "TDS Register", needsRun: true },
  { key: "pf-register", label: "PF Register", needsRun: true },
  { key: "esi-register", label: "ESI Register", needsRun: true },
  { key: "pt-register", label: "Professional Tax Register", needsRun: true },
  { key: "bank-payment-register", label: "Bank Payment Register", needsRun: true },
  { key: "regime-comparison", label: "Tax Regime Comparison", needsRun: true },
  { key: "employee-ytd", label: "Employee YTD Statement", needsRun: false, needsFy: true },
  { key: "investment-declaration", label: "Investment Declaration Report", needsRun: false, needsFy: true },
  { key: "investment-proof-status", label: "Investment Proof Status", needsRun: false, needsFy: true },
  { key: "payroll-audit", label: "Payroll Audit Report", needsRun: true },
];

function getReportData(db, key, params) {
  switch (key) {
    case "salary-register": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return { columns: SALARY_REGISTER_COLUMNS.map((c) => c[0]), rows: rows.map((r) => SALARY_REGISTER_COLUMNS.map((c) => r[c[1]])) };
    }
    case "department-wise": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return { columns: ["Department", "Employees", "Gross Salary", "Total Deductions", "TDS", "Net Salary", "Total CTC"], rows: groupSum(rows, "department") };
    }
    case "cost-centre-wise": {
      const run = db.payrollRuns.find((r) => r.id === params.runId);
      const groups = new Map();
      for (const line of run.lines) {
        const e = db.employees.find((x) => x.id === line.employeeId) || {};
        const key2 = e.costCentre || e.department || "Unassigned";
        const g = groups.get(key2) || { count: 0, gross: 0, net: 0, ctc: 0 };
        g.count++; g.gross += line.grossSalary; g.net += line.netSalary; g.ctc += line.totalEmployerCost;
        groups.set(key2, g);
      }
      return { columns: ["Cost Centre", "Employees", "Gross Salary", "Net Salary", "Total CTC"], rows: [...groups.entries()].map(([k, g]) => [k, g.count, g.gross, g.net, g.ctc]) };
    }
    case "tds-register": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return { columns: ["Employee Code", "Employee Name", "PAN", "Gross Salary", "TDS this month"], rows: rows.map((r) => [r.employeeCode, r.employeeName, r.pan, r.grossSalary, r.tds]) };
    }
    case "pf-register": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return {
        columns: ["Employee Code", "Employee Name", "UAN", "Employee PF", "Employer PF", "Total PF"],
        rows: rows.map((r) => {
          const emp = db.employees.find((e) => e.employeeCode === r.employeeCode);
          return [r.employeeCode, r.employeeName, (emp && emp.uan) || "", r.employeePf, r.employerPf, r.employeePf + r.employerPf];
        }),
      };
    }
    case "esi-register": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return { columns: ["Employee Code", "Employee Name", "Employee ESI", "Employer ESI", "Total ESI"], rows: rows.map((r) => [r.employeeCode, r.employeeName, r.employeeEsi, r.employerEsi, r.employeeEsi + r.employerEsi]) };
    }
    case "pt-register": {
      const rows = getSalaryRegisterRows(db, params.runId);
      return { columns: ["Employee Code", "Employee Name", "Location", "Professional Tax"], rows: rows.map((r) => [r.employeeCode, r.employeeName, r.department, r.professionalTax]) };
    }
    case "regime-comparison": {
      const run = db.payrollRuns.find((r) => r.id === params.runId);
      return {
        columns: ["Employee Code", "Employee Name", "Selected Regime", "Old Regime Annual Tax", "New Regime Annual Tax", "Beneficial Regime", "Difference"],
        rows: run.lines.map((line) => {
          const e = db.employees.find((x) => x.id === line.employeeId) || {};
          const snap = line.taxCalcSnapshot;
          const beneficial = snap.old.totalTaxLiability <= snap.new.totalTaxLiability ? "Old" : "New";
          return [e.employeeCode, e.fullName, line.regimeUsed, snap.old.totalTaxLiability, snap.new.totalTaxLiability, beneficial, Math.abs(snap.old.totalTaxLiability - snap.new.totalTaxLiability)];
        }),
      };
    }
    case "employee-ytd": {
      const lines = db.payrollRuns.filter((r) => r.financialYearId === params.financialYearId && params.companyIds.includes(r.companyId)).flatMap((r) => r.lines);
      const byEmployee = new Map();
      for (const line of lines) {
        const e = db.employees.find((x) => x.id === line.employeeId) || {};
        const g = byEmployee.get(e.employeeCode) || { name: e.fullName, gross: 0, ded: 0, tds: 0, net: 0, months: 0 };
        g.gross += line.grossSalary; g.ded += line.totalDeductions; g.tds += line.tdsMonthly; g.net += line.netSalary; g.months++;
        byEmployee.set(e.employeeCode, g);
      }
      return { columns: ["Employee Code", "Employee Name", "Months Processed", "Gross Salary (YTD)", "Total Deductions (YTD)", "TDS (YTD)", "Net Salary (YTD)"], rows: [...byEmployee.entries()].map(([code, g]) => [code, g.name, g.months, g.gross, g.ded, g.tds, g.net]) };
    }
    case "investment-declaration": {
      const decls = db.investmentDeclarations.filter((d) => d.financialYearId === params.financialYearId && params.companyIds.includes((db.employees.find((e) => e.id === d.employeeId) || {}).companyId));
      return {
        columns: ["Employee Code", "Employee Name", "80C (declared)", "80D", "80CCD(1B)", "Home Loan Interest", "HRA Rent (monthly)", "Donations 80G", "Proof Status"],
        rows: decls.map((d) => {
          const e = db.employees.find((x) => x.id === d.employeeId) || {};
          return [
            e.employeeCode, e.fullName,
            d.lic + d.epf + d.ppf + d.elss + d.lifeInsurance + d.tuitionFees + d.housingLoanPrincipal + d.otherSection80C,
            d.section80DSelfBelow60 + d.section80DParentsBelow60 + d.section80DSelfAbove60 + d.section80DParentsAbove60,
            d.section80CCD1B, d.homeLoanInterestSelfOccupied, d.monthlyRent, d.donations80G, d.proofStatus,
          ];
        }),
      };
    }
    case "investment-proof-status": {
      const decls = db.investmentDeclarations.filter((d) => d.financialYearId === params.financialYearId && params.companyIds.includes((db.employees.find((e) => e.id === d.employeeId) || {}).companyId));
      const counts = new Map();
      for (const d of decls) counts.set(d.proofStatus, (counts.get(d.proofStatus) || 0) + 1);
      return { columns: ["Proof Status", "Count"], rows: [...counts.entries()] };
    }
    case "payroll-audit": {
      const run = db.payrollRuns.find((r) => r.id === params.runId);
      const rows = [];
      for (const line of run.lines) {
        const e = db.employees.find((x) => x.id === line.employeeId) || {};
        for (const a of line.adjustments) rows.push([e.employeeCode, e.fullName, a.amount, a.reason, a.enteredBy, a.createdAt]);
      }
      return { columns: ["Employee Code", "Employee Name", "Amount", "Reason", "Entered By", "Date/Time"], rows };
    }
    case "bank-payment-register": {
      const { rows } = buildBankFileData(db, params.runId);
      return { columns: ["Employee Code", "Employee Name", "Bank", "Account Number", "IFSC", "Net Salary", "Payment Month", "Payment Reference"], rows: rows.map((r) => [r.employeeCode, r.employeeName, r.bankName, r.accountNumber, r.ifsc, r.netSalary, r.paymentMonth, r.paymentReference]) };
    }
    default:
      return { columns: [], rows: [] };
  }
}

const SIGNIFICANT_CHANGE_THRESHOLD_PERCENT = 10;
const SIGNIFICANT_CHANGE_THRESHOLD_ABS = 10000;

function compareRuns(db, currentRunId, previousRunId) {
  const currentRun = db.payrollRuns.find((r) => r.id === currentRunId);
  const previousRun = previousRunId ? db.payrollRuns.find((r) => r.id === previousRunId) : null;
  const currentLines = currentRun.lines;
  const previousLines = previousRun ? previousRun.lines : [];
  const previousByEmployee = new Map(previousLines.map((l) => [l.employeeId, l]));

  const rows = [];
  const metrics = [
    ["Gross Salary", (l) => l.grossSalary], ["Net Salary", (l) => l.netSalary], ["TDS", (l) => l.tdsMonthly],
    ["Total Deductions", (l) => l.totalDeductions], ["Employer Cost", (l) => l.totalEmployerCost],
  ];
  for (const cur of currentLines) {
    const e = db.employees.find((x) => x.id === cur.employeeId) || {};
    const prev = previousByEmployee.get(cur.employeeId);
    for (const [key, extract] of metrics) {
      const currentVal = extract(cur);
      const previousVal = prev ? extract(prev) : 0;
      const change = currentVal - previousVal;
      const changePercent = previousVal !== 0 ? (change / previousVal) * 100 : null;
      const flagged = Math.abs(change) >= SIGNIFICANT_CHANGE_THRESHOLD_ABS || (changePercent !== null && Math.abs(changePercent) >= SIGNIFICANT_CHANGE_THRESHOLD_PERCENT);
      rows.push({ employeeCode: e.employeeCode, employeeName: e.fullName, metric: key, previous: previousVal, current: currentVal, change, changePercent, flagged });
    }
  }
  const currentEmployeeIds = new Set(currentLines.map((l) => l.employeeId));
  const newJoiners = previousRunId ? currentLines.filter((l) => !previousByEmployee.has(l.employeeId)).length : currentLines.length;
  const leavers = previousLines.filter((l) => !currentEmployeeIds.has(l.employeeId)).length;

  return {
    rows,
    flaggedRows: rows.filter((r) => r.flagged),
    summary: {
      currentEmployeeCount: currentLines.length, previousEmployeeCount: previousLines.length, newJoiners, leavers,
      currentGross: currentLines.reduce((s, l) => s + l.grossSalary, 0), previousGross: previousLines.reduce((s, l) => s + l.grossSalary, 0),
      currentNet: currentLines.reduce((s, l) => s + l.netSalary, 0), previousNet: previousLines.reduce((s, l) => s + l.netSalary, 0),
      currentTds: currentLines.reduce((s, l) => s + l.tdsMonthly, 0), previousTds: previousLines.reduce((s, l) => s + l.tdsMonthly, 0),
    },
  };
}

function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

function downloadCsv(filename, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getSalaryRegisterRows, SALARY_REGISTER_COLUMNS, buildCombinedRegisterExport, buildBankFileData, REPORT_TYPES, getReportData, compareRuns, toCsv };
}
