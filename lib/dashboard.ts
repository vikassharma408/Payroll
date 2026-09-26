import { prisma } from "@/lib/db";
import { FY_MONTH_NAMES } from "@/lib/types";

export async function getDashboardData(financialYearId: string) {
  const fy = await prisma.financialYear.findUniqueOrThrow({ where: { id: financialYearId } });
  const totalEmployees = await prisma.employee.count({ where: { status: { not: "INACTIVE" } } });
  const runs = await prisma.payrollRun.findMany({
    where: { financialYearId },
    include: { lines: true },
    orderBy: { payrollMonthIndex: "asc" },
  });

  const latestRun = [...runs].reverse().find((r) => r.status !== "DRAFT") ?? runs[runs.length - 1];
  const employeesProcessed = latestRun?.lines.length ?? 0;
  const employeesPending = Math.max(0, totalEmployees - employeesProcessed);

  const totals = (latestRun?.lines ?? []).reduce(
    (acc, l) => {
      acc.gross += l.grossSalary;
      acc.deductions += l.totalDeductions;
      acc.tds += l.tdsMonthly;
      acc.net += l.netSalary;
      acc.employerCost += l.totalEmployerCost;
      const ec = JSON.parse(l.employerContributions) as Record<string, number>;
      const d = JSON.parse(l.deductions) as Record<string, number>;
      acc.employerPf += ec["EMPLOYER_PF"] ?? 0;
      acc.employeePf += d["EMPLOYEE_PF"] ?? 0;
      return acc;
    },
    { gross: 0, deductions: 0, tds: 0, net: 0, employerCost: 0, employerPf: 0, employeePf: 0 },
  );

  const monthlyTrend = runs.map((r) => ({
    month: FY_MONTH_NAMES[r.payrollMonthIndex - 1],
    monthIndex: r.payrollMonthIndex,
    status: r.status,
    employees: r.lines.length,
    gross: r.lines.reduce((s, l) => s + l.grossSalary, 0),
    net: r.lines.reduce((s, l) => s + l.netSalary, 0),
    tds: r.lines.reduce((s, l) => s + l.tdsMonthly, 0),
    pf: r.lines.reduce((s, l) => {
      const ec = JSON.parse(l.employerContributions) as Record<string, number>;
      const d = JSON.parse(l.deductions) as Record<string, number>;
      return s + (ec["EMPLOYER_PF"] ?? 0) + (d["EMPLOYEE_PF"] ?? 0);
    }, 0),
  }));

  return {
    fy,
    totalEmployees,
    employeesProcessed,
    employeesPending,
    latestRun,
    totals,
    monthlyTrend,
    runs,
  };
}
