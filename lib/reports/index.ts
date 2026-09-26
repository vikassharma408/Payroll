import { prisma } from "@/lib/db";
import { getSalaryRegisterRows, SALARY_REGISTER_COLUMNS, type SalaryRegisterRow } from "./salary-register";

export { getSalaryRegisterRows, SALARY_REGISTER_COLUMNS };
export type { SalaryRegisterRow };

export const REPORT_TYPES = [
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
  { key: "annual-salary-statement", label: "Annual Salary Statement", needsRun: false, needsFy: true },
  { key: "investment-declaration", label: "Investment Declaration Report", needsRun: false, needsFy: true },
  { key: "investment-proof-status", label: "Investment Proof Status", needsRun: false, needsFy: true },
  { key: "payroll-audit", label: "Payroll Audit Report", needsRun: true },
] as const;

export type ReportKey = (typeof REPORT_TYPES)[number]["key"];

export interface ReportResult {
  columns: string[];
  rows: (string | number)[][];
}

function num(n: number) {
  return Math.round(n * 100) / 100;
}

function groupSum(rows: SalaryRegisterRow[], groupField: "department" | "designation") {
  const groups = new Map<string, SalaryRegisterRow[]>();
  for (const r of rows) {
    const key = r[groupField] || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: (string | number)[][] = [];
  for (const [key, groupRows] of groups) {
    out.push([
      key,
      groupRows.length,
      num(groupRows.reduce((s, r) => s + r.grossSalary, 0)),
      num(groupRows.reduce((s, r) => s + r.totalDeductions, 0)),
      num(groupRows.reduce((s, r) => s + r.tds, 0)),
      num(groupRows.reduce((s, r) => s + r.netSalary, 0)),
      num(groupRows.reduce((s, r) => s + r.totalCtc, 0)),
    ]);
  }
  return out;
}

export async function getReportData(key: ReportKey, params: { runId?: string; financialYearId?: string }): Promise<ReportResult> {
  switch (key) {
    case "salary-register": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: SALARY_REGISTER_COLUMNS.map((c) => c.header),
        rows: rows.map((r) => SALARY_REGISTER_COLUMNS.map((c) => r[c.field])),
      };
    }
    case "department-wise": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: ["Department", "Employees", "Gross Salary", "Total Deductions", "TDS", "Net Salary", "Total CTC"],
        rows: groupSum(rows, "department"),
      };
    }
    case "cost-centre-wise": {
      const lines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: params.runId! }, include: { employee: true } });
      const groups = new Map<string, { count: number; gross: number; net: number; ctc: number }>();
      for (const line of lines) {
        const key = line.employee.costCentre || line.employee.department || "Unassigned";
        const g = groups.get(key) ?? { count: 0, gross: 0, net: 0, ctc: 0 };
        g.count++;
        g.gross += line.grossSalary;
        g.net += line.netSalary;
        g.ctc += line.totalEmployerCost;
        groups.set(key, g);
      }
      return {
        columns: ["Cost Centre", "Employees", "Gross Salary", "Net Salary", "Total CTC"],
        rows: [...groups.entries()].map(([k, g]) => [k, g.count, num(g.gross), num(g.net), num(g.ctc)]),
      };
    }
    case "tds-register": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: ["Employee Code", "Employee Name", "PAN", "Gross Salary", "TDS this month"],
        rows: rows.map((r) => [r.employeeCode, r.employeeName, r.pan, r.grossSalary, r.tds]),
      };
    }
    case "pf-register": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: ["Employee Code", "Employee Name", "UAN", "Employee PF", "Employer PF", "Total PF"],
        rows: await Promise.all(
          rows.map(async (r) => {
            const emp = await prisma.employee.findUnique({ where: { employeeCode: r.employeeCode } });
            return [r.employeeCode, r.employeeName, emp?.uan ?? "", r.employeePf, r.employerPf, num(r.employeePf + r.employerPf)];
          }),
        ),
      };
    }
    case "esi-register": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: ["Employee Code", "Employee Name", "Employee ESI", "Employer ESI", "Total ESI"],
        rows: rows.map((r) => [r.employeeCode, r.employeeName, r.employeeEsi, r.employerEsi, num(r.employeeEsi + r.employerEsi)]),
      };
    }
    case "pt-register": {
      const rows = await getSalaryRegisterRows(params.runId!);
      return {
        columns: ["Employee Code", "Employee Name", "Location", "Professional Tax"],
        rows: rows.map((r) => [r.employeeCode, r.employeeName, r.department, r.professionalTax]),
      };
    }
    case "regime-comparison": {
      const lines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: params.runId! }, include: { employee: true } });
      return {
        columns: ["Employee Code", "Employee Name", "Selected Regime", "Old Regime Annual Tax", "New Regime Annual Tax", "Beneficial Regime", "Difference"],
        rows: lines.map((line) => {
          const snap = JSON.parse(line.taxCalcSnapshot) as { old: { totalTaxLiability: number }; new: { totalTaxLiability: number } };
          const beneficial = snap.old.totalTaxLiability <= snap.new.totalTaxLiability ? "Old" : "New";
          return [
            line.employee.employeeCode,
            line.employee.fullName,
            line.regimeUsed,
            num(snap.old.totalTaxLiability),
            num(snap.new.totalTaxLiability),
            beneficial,
            num(Math.abs(snap.old.totalTaxLiability - snap.new.totalTaxLiability)),
          ];
        }),
      };
    }
    case "employee-ytd":
    case "annual-salary-statement": {
      const lines = await prisma.payrollRunLine.findMany({
        where: { payrollRun: { financialYearId: params.financialYearId! } },
        include: { employee: true, payrollRun: true },
      });
      const byEmployee = new Map<string, { name: string; gross: number; ded: number; tds: number; net: number; months: number }>();
      for (const line of lines) {
        const key = line.employee.employeeCode;
        const g = byEmployee.get(key) ?? { name: line.employee.fullName, gross: 0, ded: 0, tds: 0, net: 0, months: 0 };
        g.gross += line.grossSalary;
        g.ded += line.totalDeductions;
        g.tds += line.tdsMonthly;
        g.net += line.netSalary;
        g.months++;
        byEmployee.set(key, g);
      }
      return {
        columns: ["Employee Code", "Employee Name", "Months Processed", "Gross Salary (YTD)", "Total Deductions (YTD)", "TDS (YTD)", "Net Salary (YTD)"],
        rows: [...byEmployee.entries()].map(([code, g]) => [code, g.name, g.months, num(g.gross), num(g.ded), num(g.tds), num(g.net)]),
      };
    }
    case "investment-declaration": {
      const decls = await prisma.investmentDeclaration.findMany({
        where: { financialYearId: params.financialYearId! },
        include: { employee: true },
      });
      return {
        columns: ["Employee Code", "Employee Name", "80C (declared)", "80D", "80CCD(1B)", "Home Loan Interest", "HRA Rent (monthly)", "Donations 80G", "Proof Status"],
        rows: decls.map((d) => [
          d.employee.employeeCode,
          d.employee.fullName,
          d.lic + d.epf + d.ppf + d.elss + d.lifeInsurance + d.tuitionFees + d.housingLoanPrincipal + d.otherSection80C,
          d.section80DSelfBelow60 + d.section80DParentsBelow60 + d.section80DSelfAbove60 + d.section80DParentsAbove60,
          d.section80CCD1B,
          d.homeLoanInterestSelfOccupied,
          d.monthlyRent,
          d.donations80G,
          d.proofStatus,
        ]),
      };
    }
    case "investment-proof-status": {
      const decls = await prisma.investmentDeclaration.findMany({ where: { financialYearId: params.financialYearId! } });
      const counts = new Map<string, number>();
      for (const d of decls) counts.set(d.proofStatus, (counts.get(d.proofStatus) ?? 0) + 1);
      return { columns: ["Proof Status", "Count"], rows: [...counts.entries()] };
    }
    case "payroll-audit": {
      const adjustments = await prisma.payrollAdjustment.findMany({
        where: { payrollRunLine: { payrollRunId: params.runId! } },
        include: { payrollRunLine: { include: { employee: true } } },
        orderBy: { createdAt: "asc" },
      });
      return {
        columns: ["Employee Code", "Employee Name", "Amount", "Reason", "Entered By", "Date/Time"],
        rows: adjustments.map((a) => [
          a.payrollRunLine.employee.employeeCode,
          a.payrollRunLine.employee.fullName,
          a.amount,
          a.reason,
          a.enteredBy,
          a.createdAt.toISOString(),
        ]),
      };
    }
    case "bank-payment-register": {
      const { rows } = await (await import("@/lib/bank-file")).buildBankFileData(params.runId!);
      return {
        columns: ["Employee Code", "Employee Name", "Bank", "Account Number", "IFSC", "Net Salary", "Payment Month", "Payment Reference"],
        rows: rows.map((r) => [r.employeeCode, r.employeeName, r.bankName, r.accountNumber, r.ifsc, r.netSalary, r.paymentMonth, r.paymentReference]),
      };
    }
  }
}
