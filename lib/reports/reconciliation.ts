import { prisma } from "@/lib/db";

export interface ReconciliationRow {
  employeeCode: string;
  employeeName: string;
  metric: string;
  previous: number;
  current: number;
  change: number;
  changePercent: number | null;
  flagged: boolean;
}

const SIGNIFICANT_CHANGE_THRESHOLD_PERCENT = 10; // flag swings >10%
const SIGNIFICANT_CHANGE_THRESHOLD_ABS = 10000; // or absolute swings > Rs 10,000

export async function compareRuns(currentRunId: string, previousRunId: string | null) {
  const currentLines = await prisma.payrollRunLine.findMany({ where: { payrollRunId: currentRunId }, include: { employee: true } });
  const previousLines = previousRunId
    ? await prisma.payrollRunLine.findMany({ where: { payrollRunId: previousRunId }, include: { employee: true } })
    : [];
  const previousByEmployee = new Map(previousLines.map((l) => [l.employeeId, l]));

  const rows: ReconciliationRow[] = [];
  const metrics: { key: string; extract: (l: { grossSalary: number; netSalary: number; tdsMonthly: number; totalEmployerCost: number; totalDeductions: number }) => number }[] = [
    { key: "Gross Salary", extract: (l) => l.grossSalary },
    { key: "Net Salary", extract: (l) => l.netSalary },
    { key: "TDS", extract: (l) => l.tdsMonthly },
    { key: "Total Deductions", extract: (l) => l.totalDeductions },
    { key: "Employer Cost", extract: (l) => l.totalEmployerCost },
  ];

  for (const cur of currentLines) {
    const prev = previousByEmployee.get(cur.employeeId);
    for (const m of metrics) {
      const currentVal = m.extract(cur);
      const previousVal = prev ? m.extract(prev) : 0;
      const change = currentVal - previousVal;
      const changePercent = previousVal !== 0 ? (change / previousVal) * 100 : null;
      const flagged = Math.abs(change) >= SIGNIFICANT_CHANGE_THRESHOLD_ABS || (changePercent !== null && Math.abs(changePercent) >= SIGNIFICANT_CHANGE_THRESHOLD_PERCENT);
      rows.push({
        employeeCode: cur.employee.employeeCode,
        employeeName: cur.employee.fullName,
        metric: m.key,
        previous: previousVal,
        current: currentVal,
        change,
        changePercent,
        flagged,
      });
    }
  }

  const currentEmployeeIds = new Set(currentLines.map((l) => l.employeeId));
  const newJoiners = previousRunId ? currentLines.filter((l) => !previousByEmployee.has(l.employeeId)).length : currentLines.length;
  const leavers = previousLines.filter((l) => !currentEmployeeIds.has(l.employeeId)).length;

  return {
    rows,
    flaggedRows: rows.filter((r) => r.flagged),
    summary: {
      currentEmployeeCount: currentLines.length,
      previousEmployeeCount: previousLines.length,
      newJoiners,
      leavers,
      currentGross: currentLines.reduce((s, l) => s + l.grossSalary, 0),
      previousGross: previousLines.reduce((s, l) => s + l.grossSalary, 0),
      currentNet: currentLines.reduce((s, l) => s + l.netSalary, 0),
      previousNet: previousLines.reduce((s, l) => s + l.netSalary, 0),
      currentTds: currentLines.reduce((s, l) => s + l.tdsMonthly, 0),
      previousTds: previousLines.reduce((s, l) => s + l.tdsMonthly, 0),
    },
  };
}
