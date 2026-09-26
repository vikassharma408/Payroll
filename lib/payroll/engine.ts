import { prisma } from "@/lib/db";
import { calculateTax, type TaxCalcInput, type TaxCalcResult } from "@/lib/tax-engine/calculate";
import { getTaxRuleSetConfig, deriveAgeCategory } from "@/lib/tax-engine";
import { monthlyHraExemption } from "@/lib/tax-engine/hra";
import type { Regime } from "@/lib/types";
import { calendarToFyMonthIndex, daysInCalendarMonth } from "./dates";

const PERQ_CHECK_CODES = ["EMPLOYER_PF", "EMPLOYER_NPS", "EMPLOYER_SUPERANNUATION"];
const BASIC_DA_CODES = ["BASIC", "DA"];
const NOT_PRORATED_DEDUCTION_CODES = ["PROFESSIONAL_TAX", "LWF", "LOAN_RECOVERY", "SALARY_ADVANCE"];

interface ComponentAmount {
  code: string;
  category: string;
  monthlyAmount: number;
}

async function getActiveStructureComponents(
  employeeId: string,
  financialYearId: string,
  asOfDate: Date,
): Promise<{ annualCTC: number; components: ComponentAmount[] } | null> {
  const structure = await prisma.employeeSalaryStructure.findFirst({
    where: {
      employeeId,
      financialYearId,
      isActive: true,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
    include: { components: { include: { component: true } } },
  });
  if (!structure) return null;
  return {
    annualCTC: structure.annualCTC,
    components: structure.components.map((c) => ({
      code: c.component.code,
      category: c.component.category,
      monthlyAmount: c.monthlyAmount,
    })),
  };
}

function sumCodes(map: Record<string, number>, codes: string[]) {
  return codes.reduce((s, code) => s + (map[code] ?? 0), 0);
}

export interface ProcessLineOptions {
  daysWorked?: number;
  lopDays?: number;
}

export interface ProcessedLineResult {
  daysInMonth: number;
  daysWorked: number;
  lopDays: number;
  earnings: Record<string, number>;
  grossSalary: number;
  employerContributions: Record<string, number>;
  totalEmployerCost: number;
  deductions: Record<string, number>;
  tdsMonthly: number;
  totalDeductions: number;
  netSalary: number;
  regimeUsed: Regime;
  taxCalcSnapshot: { old: TaxCalcResult; new: TaxCalcResult };
  metrics: { hraExemptionThisMonth: number; rentPaidThisMonth: number; prorationFactor: number };
}

/** Computes (without persisting) the full payroll + both-regime tax result for one employee in one run. */
export async function computeEmployeePayrollLine(
  runId: string,
  employeeId: string,
  options: ProcessLineOptions = {},
): Promise<ProcessedLineResult> {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { financialYear: true } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const fy = run.financialYear;
  const currentIndex = run.payrollMonthIndex;
  const daysInMonth = daysInCalendarMonth(run.calendarYear, run.calendarMonth);
  const currentMonthDate = new Date(run.calendarYear, run.calendarMonth - 1, 1);

  const structure = await getActiveStructureComponents(employeeId, fy.id, currentMonthDate);
  if (!structure) {
    throw new Error(`No active salary structure for employee ${employee.employeeCode} in FY ${fy.code}`);
  }

  let lastActiveMonthIndex = 12;
  if (employee.dateOfLeaving && employee.dateOfLeaving >= fy.startDate && employee.dateOfLeaving <= fy.endDate) {
    lastActiveMonthIndex = calendarToFyMonthIndex(
      employee.dateOfLeaving.getFullYear(),
      employee.dateOfLeaving.getMonth() + 1,
    );
  }

  const lopDays = options.lopDays ?? 0;
  const daysWorked = options.daysWorked ?? daysInMonth - lopDays;
  const prorationFactor = daysInMonth > 0 ? Math.max(0, Math.min(1, daysWorked / daysInMonth)) : 1;

  const earnings: Record<string, number> = {};
  let grossSalary = 0;
  for (const c of structure.components.filter((c) => c.category === "EARNING")) {
    const amt = Math.round(c.monthlyAmount * prorationFactor);
    earnings[c.code] = amt;
    grossSalary += amt;
  }

  const employerContributions: Record<string, number> = {};
  let totalEmployerContrib = 0;
  for (const c of structure.components.filter((c) => c.category === "EMPLOYER_CONTRIBUTION")) {
    const amt = Math.round(c.monthlyAmount * prorationFactor);
    employerContributions[c.code] = amt;
    totalEmployerContrib += amt;
  }

  const deductions: Record<string, number> = {};
  let totalDeductionsExclTds = 0;
  for (const c of structure.components.filter((c) => c.category === "DEDUCTION")) {
    const amt = NOT_PRORATED_DEDUCTION_CODES.includes(c.code)
      ? Math.round(c.monthlyAmount)
      : Math.round(c.monthlyAmount * prorationFactor);
    deductions[c.code] = amt;
    totalDeductionsExclTds += amt;
  }

  const basicPlusDaThisMonth = sumCodes(earnings, BASIC_DA_CODES);
  const employerPfNpsSuperThisMonth = sumCodes(employerContributions, PERQ_CHECK_CODES);
  const employerNpsThisMonth = employerContributions["EMPLOYER_NPS"] ?? 0;
  const ptThisMonth = deductions["PROFESSIONAL_TAX"] ?? 0;

  const declaration = await prisma.investmentDeclaration.findUnique({
    where: { employeeId_financialYearId: { employeeId, financialYearId: fy.id } },
  });
  const prevEmployer = await prisma.previousEmployerIncome.findFirst({
    where: { employeeId, financialYearId: fy.id },
  });

  const [oldConfig, newConfig] = await Promise.all([
    getTaxRuleSetConfig(fy.code, "OLD", currentMonthDate),
    getTaxRuleSetConfig(fy.code, "NEW", currentMonthDate),
  ]);

  const rentPaidThisMonth = (declaration?.monthlyRent ?? 0) * prorationFactor;
  const hraExemptionThisMonth = monthlyHraExemption(
    {
      basic: basicPlusDaThisMonth,
      hraReceived: earnings["HRA"] ?? 0,
      rentPaid: rentPaidThisMonth,
      isMetro: employee.isMetroCity,
    },
    oldConfig.hraConfig,
  );

  // --- YTD from prior processed months (derived from already-stored lines) ---
  const priorLines = await prisma.payrollRunLine.findMany({
    where: { employeeId, payrollRun: { financialYearId: fy.id, payrollMonthIndex: { lt: currentIndex } } },
  });
  let ytdGross = 0;
  let ytdBasicPlusDa = 0;
  let ytdEmployerPfNpsSuper = 0;
  let ytdEmployerNps = 0;
  let ytdPt = 0;
  let ytdHraExemption = 0;
  let ytdTds = 0;
  for (const line of priorLines) {
    const e = JSON.parse(line.earnings) as Record<string, number>;
    const ec = JSON.parse(line.employerContributions) as Record<string, number>;
    const d = JSON.parse(line.deductions) as Record<string, number>;
    const m = JSON.parse(line.metrics) as { hraExemptionThisMonth: number };
    ytdGross += line.grossSalary;
    ytdBasicPlusDa += sumCodes(e, BASIC_DA_CODES);
    ytdEmployerPfNpsSuper += sumCodes(ec, PERQ_CHECK_CODES);
    ytdEmployerNps += ec["EMPLOYER_NPS"] ?? 0;
    ytdPt += d["PROFESSIONAL_TAX"] ?? 0;
    ytdHraExemption += m.hraExemptionThisMonth ?? 0;
    ytdTds += line.tdsMonthly;
  }

  // --- Project remaining months (after current, up to last active month) using the current structure ---
  const remainingProjectionMonths = Math.max(0, lastActiveMonthIndex - currentIndex);
  const projGrossPerMonth = structure.components.filter((c) => c.category === "EARNING").reduce((s, c) => s + c.monthlyAmount, 0);
  const structureEmployerMap = Object.fromEntries(
    structure.components.filter((c) => c.category === "EMPLOYER_CONTRIBUTION").map((c) => [c.code, c.monthlyAmount]),
  );
  const structureDeductionMap = Object.fromEntries(
    structure.components.filter((c) => c.category === "DEDUCTION").map((c) => [c.code, c.monthlyAmount]),
  );
  const structureEarningMap = Object.fromEntries(
    structure.components.filter((c) => c.category === "EARNING").map((c) => [c.code, c.monthlyAmount]),
  );
  const projEmployerPfNpsSuperPerMonth = sumCodes(structureEmployerMap, PERQ_CHECK_CODES);
  const projEmployerNpsPerMonth = structureEmployerMap["EMPLOYER_NPS"] ?? 0;
  const projPtPerMonth = structureDeductionMap["PROFESSIONAL_TAX"] ?? 0;
  const projBasicPlusDaPerMonth = sumCodes(structureEarningMap, BASIC_DA_CODES);
  const projHraExemptionPerMonth = monthlyHraExemption(
    {
      basic: projBasicPlusDaPerMonth,
      hraReceived: structureEarningMap["HRA"] ?? 0,
      rentPaid: declaration?.monthlyRent ?? 0,
      isMetro: employee.isMetroCity,
    },
    oldConfig.hraConfig,
  );

  const annualGross = ytdGross + grossSalary + remainingProjectionMonths * projGrossPerMonth;
  const annualBasicPlusDa = ytdBasicPlusDa + basicPlusDaThisMonth + remainingProjectionMonths * projBasicPlusDaPerMonth;
  const annualEmployerPfNpsSuper =
    ytdEmployerPfNpsSuper + employerPfNpsSuperThisMonth + remainingProjectionMonths * projEmployerPfNpsSuperPerMonth;
  const annualEmployerNps = ytdEmployerNps + employerNpsThisMonth + remainingProjectionMonths * projEmployerNpsPerMonth;
  const annualPt = ytdPt + ptThisMonth + remainingProjectionMonths * projPtPerMonth;
  const annualHraExemption = ytdHraExemption + hraExemptionThisMonth + remainingProjectionMonths * projHraExemptionPerMonth;

  const remainingMonthsForTds = Math.max(1, Math.min(13 - currentIndex, lastActiveMonthIndex - currentIndex + 1));

  const ageCategory = deriveAgeCategory(employee.dob, fy.endDate);
  const section80C =
    (declaration?.lic ?? 0) +
    (declaration?.epf ?? 0) +
    (declaration?.ppf ?? 0) +
    (declaration?.elss ?? 0) +
    (declaration?.lifeInsurance ?? 0) +
    (declaration?.tuitionFees ?? 0) +
    (declaration?.housingLoanPrincipal ?? 0) +
    (declaration?.otherSection80C ?? 0) +
    (declaration?.section80CCC ?? 0) +
    (declaration?.section80CCD1 ?? 0);

  function buildInput(regime: Regime): TaxCalcInput {
    return {
      regime,
      ageCategory,
      grossSalaryCurrentEmployer: annualGross,
      perquisitesOther: 0,
      employerNpsContribution: annualEmployerNps,
      employerPfNpsSuperContribution: annualEmployerPfNpsSuper,
      previousEmployerTaxableSalary: prevEmployer?.taxableSalary ?? 0,
      hraExemption: annualHraExemption,
      professionalTaxPaid: annualPt,
      selfOccupiedHomeLoanInterest: declaration?.homeLoanInterestSelfOccupied ?? 0,
      letOutAnnualValue: declaration?.letOutAnnualValue ?? 0,
      letOutMunicipalTax: declaration?.letOutMunicipalTax ?? 0,
      letOutHomeLoanInterest: declaration?.letOutHomeLoanInterest ?? 0,
      otherIncomeDeclared: 0,
      deductions: {
        section80C,
        section80CCD1B: declaration?.section80CCD1B ?? 0,
        section80CCD2Employer: annualEmployerNps,
        basicPlusDaAnnual: annualBasicPlusDa,
        section80DSelfBelow60: declaration?.section80DSelfBelow60 ?? 0,
        section80DParentsBelow60: declaration?.section80DParentsBelow60 ?? 0,
        section80DSelfAbove60: declaration?.section80DSelfAbove60 ?? 0,
        section80DParentsAbove60: declaration?.section80DParentsAbove60 ?? 0,
        section80E: declaration?.section80E ?? 0,
        section80EE: declaration?.section80EE ?? 0,
        section80EEA: declaration?.section80EEA ?? 0,
        section80UBelow80: declaration?.section80UBelow80 ?? 0,
        section80U80AndAbove: declaration?.section80U80AndAbove ?? 0,
        section80DDBelow80: declaration?.section80DDBelow80 ?? 0,
        section80DD80AndAbove: declaration?.section80DD80AndAbove ?? 0,
        donations80G: declaration?.donations80G ?? 0,
        otherDeductions: declaration?.otherDeductions ?? 0,
      },
      tdsAlreadyDeductedCurrentEmployer: ytdTds,
      tdsDeductedPreviousEmployer: prevEmployer?.tdsDeducted ?? 0,
      remainingMonthsInFY: remainingMonthsForTds,
    };
  }

  const oldResult = calculateTax(buildInput("OLD"), oldConfig);
  const newResult = calculateTax(buildInput("NEW"), newConfig);

  const regimeUsed = employee.taxRegime as Regime;
  const tdsMonthly = regimeUsed === "OLD" ? oldResult.monthlyTds : newResult.monthlyTds;
  const totalDeductions = totalDeductionsExclTds + tdsMonthly;
  const netSalary = grossSalary - totalDeductions;

  return {
    daysInMonth,
    daysWorked,
    lopDays,
    earnings,
    grossSalary,
    employerContributions,
    totalEmployerCost: grossSalary + totalEmployerContrib,
    deductions,
    tdsMonthly,
    totalDeductions,
    netSalary,
    regimeUsed,
    taxCalcSnapshot: { old: oldResult, new: newResult },
    metrics: { hraExemptionThisMonth, rentPaidThisMonth, prorationFactor },
  };
}

async function isEmployeeEligibleForRun(
  employee: { dateOfJoining: Date; dateOfLeaving: Date | null; status: string; payrollGroup: string | null },
  run: { calendarYear: number; calendarMonth: number; payrollGroup: string | null },
) {
  if (employee.status === "INACTIVE") return false;
  const monthStart = new Date(run.calendarYear, run.calendarMonth - 1, 1);
  const monthEnd = new Date(run.calendarYear, run.calendarMonth, 0);
  if (employee.dateOfJoining > monthEnd) return false;
  if (employee.dateOfLeaving && employee.dateOfLeaving < monthStart) return false;
  if (run.payrollGroup && employee.payrollGroup !== run.payrollGroup) return false;
  return true;
}

export async function processPayrollRun(runId: string): Promise<{ processed: number; skipped: { employeeCode: string; reason: string }[] }> {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status === "LOCKED" || run.status === "PAID") {
    throw new Error(`Payroll run is ${run.status} and cannot be recalculated. Use an adjustment instead.`);
  }
  const employees = await prisma.employee.findMany({ where: { status: { not: "INACTIVE" } } });
  const skipped: { employeeCode: string; reason: string }[] = [];
  let processed = 0;

  for (const employee of employees) {
    const eligible = await isEmployeeEligibleForRun(employee, run);
    if (!eligible) continue;
    try {
      const result = await computeEmployeePayrollLine(runId, employee.id);
      await prisma.payrollRunLine.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: employee.id } },
        create: {
          payrollRunId: runId,
          employeeId: employee.id,
          daysInMonth: result.daysInMonth,
          daysWorked: result.daysWorked,
          lopDays: result.lopDays,
          earnings: JSON.stringify(result.earnings),
          grossSalary: result.grossSalary,
          employerContributions: JSON.stringify(result.employerContributions),
          totalEmployerCost: result.totalEmployerCost,
          deductions: JSON.stringify(result.deductions),
          tdsMonthly: result.tdsMonthly,
          totalDeductions: result.totalDeductions,
          netSalary: result.netSalary,
          regimeUsed: result.regimeUsed,
          taxCalcSnapshot: JSON.stringify(result.taxCalcSnapshot),
          metrics: JSON.stringify(result.metrics),
        },
        update: {
          daysInMonth: result.daysInMonth,
          daysWorked: result.daysWorked,
          lopDays: result.lopDays,
          earnings: JSON.stringify(result.earnings),
          grossSalary: result.grossSalary,
          employerContributions: JSON.stringify(result.employerContributions),
          totalEmployerCost: result.totalEmployerCost,
          deductions: JSON.stringify(result.deductions),
          tdsMonthly: result.tdsMonthly,
          totalDeductions: result.totalDeductions,
          netSalary: result.netSalary,
          regimeUsed: result.regimeUsed,
          taxCalcSnapshot: JSON.stringify(result.taxCalcSnapshot),
          metrics: JSON.stringify(result.metrics),
        },
      });
      processed++;
    } catch (err) {
      skipped.push({ employeeCode: employee.employeeCode, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATED", processedAt: new Date() } });
  return { processed, skipped };
}
