import { PrismaClient } from "@prisma/client";
import { TAX_RULE_CONFIGS, FINANCIAL_YEARS } from "../lib/tax-engine/rule-configs";
import { SALARY_COMPONENTS, BANK_FILE_TEMPLATES } from "../lib/master-data";
import { processPayrollRun } from "../lib/payroll/engine";
import { advancePayrollStatus, addAdjustment } from "../lib/payroll/workflow";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding company + admin user...");
  await prisma.company.deleteMany();
  await prisma.company.create({
    data: {
      name: "DSP HMK Holdings Pvt Ltd",
      address: "Mumbai, Maharashtra, India",
      pan: "AABCD1234E",
      tan: "MUMD12345E",
      bankName: "HDFC Bank",
      bankAccountNo: "50100123456789",
      bankIfsc: "HDFC0000123",
    },
  });
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: { email: "admin@example.com", name: "Payroll Admin", passwordHash: "seed-only-not-a-real-login", role: "ADMIN" },
  });

  console.log("Seeding financial years...");
  const fyByCode = new Map<string, string>();
  for (const fy of FINANCIAL_YEARS) {
    const row = await prisma.financialYear.upsert({
      where: { code: fy.code },
      update: { startDate: new Date(fy.startDate), endDate: new Date(fy.endDate), isCurrent: fy.isCurrent },
      create: { code: fy.code, startDate: new Date(fy.startDate), endDate: new Date(fy.endDate), isCurrent: fy.isCurrent },
    });
    fyByCode.set(fy.code, row.id);
  }

  console.log("Seeding tax rule sets, slabs and rule catalog...");
  for (const cfg of TAX_RULE_CONFIGS) {
    const financialYearId = fyByCode.get(cfg.financialYearCode)!;
    const existing = await prisma.taxRuleSet.findFirst({
      where: { financialYearId, regime: cfg.regime, effectiveFrom: new Date(cfg.effectiveFrom) },
    });
    if (existing) {
      await prisma.taxSlab.deleteMany({ where: { taxRuleSetId: existing.id } });
      await prisma.taxRule.deleteMany({ where: { taxRuleSetId: existing.id } });
      await prisma.taxRuleSet.delete({ where: { id: existing.id } });
    }
    await prisma.taxRuleSet.create({
      data: {
        financialYearId,
        regime: cfg.regime,
        effectiveFrom: new Date(cfg.effectiveFrom),
        standardDeduction: cfg.standardDeduction,
        cessRate: cfg.cessRate,
        rebateLimitOld: cfg.rebateLimitOld,
        rebateMaxOld: cfg.rebateMaxOld,
        rebateLimitNew: cfg.rebateLimitNew,
        marginalReliefNew: cfg.marginalReliefNew,
        npsEmployerCapPercent: cfg.npsEmployerCapPercent,
        employerNpsPfPerqLimit: cfg.employerNpsPfPerqLimit,
        surchargeConfig: JSON.stringify(cfg.surchargeConfig),
        deductionLimits: JSON.stringify(cfg.deductionLimits),
        hraConfig: JSON.stringify(cfg.hraConfig),
        notes: cfg.notes,
        slabs: { create: cfg.slabs },
        rules: { create: cfg.rules },
      },
    });
  }

  console.log("Seeding salary component master...");
  for (const c of SALARY_COMPONENTS) {
    await prisma.salaryComponent.upsert({
      where: { code: c.code },
      update: { name: c.name, category: c.category, taxability: c.taxability, order: c.order },
      create: { code: c.code, name: c.name, category: c.category, taxability: c.taxability, order: c.order, isFixed: true },
    });
  }

  console.log("Seeding bank payment templates...");
  for (const t of BANK_FILE_TEMPLATES) {
    await prisma.bankFileTemplate.upsert({
      where: { code: t.code },
      update: { bankName: t.bankName, delimiter: t.delimiter, columns: JSON.stringify(t.columns) },
      create: { bankName: t.bankName, code: t.code, delimiter: t.delimiter, columns: JSON.stringify(t.columns) },
    });
  }

  const fy2627Id = fyByCode.get("2026-27")!;

  console.log("Seeding demo employees (Mr. A / Mr. B / Mr. C, matching the reference FY 2026-27 workbook)...");
  const componentByCode = new Map(
    (await prisma.salaryComponent.findMany()).map((c) => [c.code, c.id]),
  );

  async function createEmployee(input: {
    employeeCode: string;
    fullName: string;
    dob: string;
    department: string;
    designation: string;
    location: string;
    isMetroCity: boolean;
    components: { code: string; monthly: number }[];
  }) {
    const employee = await prisma.employee.upsert({
      where: { employeeCode: input.employeeCode },
      update: {},
      create: {
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        dob: new Date(input.dob),
        gender: "Unspecified",
        pan: `${input.employeeCode}PAN01A`.slice(0, 10).toUpperCase(),
        dateOfJoining: new Date("2020-01-01"),
        department: input.department,
        designation: input.designation,
        location: input.location,
        payrollGroup: "MONTHLY",
        uan: `1001${input.employeeCode}`,
        pfApplicable: true,
        esiApplicable: false,
        ptApplicable: true,
        taxRegime: "NEW",
        status: "ACTIVE",
        bankName: "HDFC Bank",
        bankAccountNo: `${input.employeeCode}00011122233`,
        bankIfsc: "HDFC0000123",
        isMetroCity: input.isMetroCity,
      },
    });

    const annualCTC = input.components.reduce((s, c) => s + c.monthly * 12, 0);
    const structure = await prisma.employeeSalaryStructure.create({
      data: {
        employeeId: employee.id,
        financialYearId: fy2627Id,
        annualCTC,
        effectiveFrom: new Date("2026-04-01"),
        isActive: true,
      },
    });
    for (const c of input.components) {
      const componentId = componentByCode.get(c.code);
      if (!componentId) throw new Error(`Unknown component code ${c.code}`);
      await prisma.employeeSalaryComponentValue.create({
        data: {
          structureId: structure.id,
          componentId,
          monthlyAmount: c.monthly,
          annualAmount: c.monthly * 12,
          formulaUsed: `Fixed amount: Rs ${c.monthly.toLocaleString("en-IN")}/month`,
        },
      });
    }

    await prisma.investmentDeclaration.upsert({
      where: { employeeId_financialYearId: { employeeId: employee.id, financialYearId: fy2627Id } },
      update: {},
      create: { employeeId: employee.id, financialYearId: fy2627Id },
    });

    return employee;
  }

  const mrA = await createEmployee({
    employeeCode: "EMP001",
    fullName: "Mr. A",
    dob: "1990-05-15",
    department: "Finance",
    designation: "Manager",
    location: "Mumbai",
    isMetroCity: false,
    components: [
      { code: "BASIC", monthly: 35050 },
      { code: "HRA", monthly: 25000 },
      { code: "SPECIAL_ALLOWANCE", monthly: 20000 },
      { code: "CONVEYANCE", monthly: 17650 },
      { code: "BONUS", monthly: Math.round((275000 / 12) * 100) / 100 },
      { code: "EMPLOYER_NPS", monthly: 2300 },
      { code: "PROFESSIONAL_TAX", monthly: 200 },
    ],
  });

  await createEmployee({
    employeeCode: "EMP002",
    fullName: "Mr. B",
    dob: "1960-03-10",
    department: "Operations",
    designation: "Director",
    location: "Delhi",
    isMetroCity: true,
    components: [
      { code: "BASIC", monthly: 128500 },
      { code: "HRA", monthly: 91700 },
      { code: "SPECIAL_ALLOWANCE", monthly: 73400 },
      { code: "CONVEYANCE", monthly: 73400 },
      { code: "BONUS", monthly: Math.round((2900000 / 12) * 100) / 100 },
    ],
  });

  const mrC = await createEmployee({
    employeeCode: "EMP003",
    fullName: "Mr. C",
    dob: "1995-08-20",
    department: "Sales",
    designation: "Executive",
    location: "Bengaluru",
    isMetroCity: true,
    components: [
      { code: "BASIC", monthly: 24900 },
      { code: "HRA", monthly: 17800 },
      { code: "SPECIAL_ALLOWANCE", monthly: 14200 },
      { code: "CONVEYANCE", monthly: 14100 },
      { code: "BONUS", monthly: Math.round((100000 / 12) * 100) / 100 },
      { code: "PROFESSIONAL_TAX", monthly: 200 },
    ],
  });

  console.log("Processing April 2026 payroll run through its full lifecycle...");
  const aprilRun = await prisma.payrollRun.create({
    data: {
      financialYearId: fy2627Id,
      payrollMonthIndex: 1,
      calendarYear: 2026,
      calendarMonth: 4,
      payrollGroup: null,
      status: "DRAFT",
      createdBy: "seed-script",
    },
  });
  await processPayrollRun(aprilRun.id);
  await advancePayrollStatus(aprilRun.id, "REVIEWED");
  await advancePayrollStatus(aprilRun.id, "APPROVED");
  await advancePayrollStatus(aprilRun.id, "LOCKED");

  const mrCLine = await prisma.payrollRunLine.findFirstOrThrow({ where: { payrollRunId: aprilRun.id, employeeId: mrC.id } });
  await addAdjustment({
    payrollRunLineId: mrCLine.id,
    amount: 5000,
    reason: "One-time spot recognition award approved by department head",
    enteredBy: "Payroll Admin",
  });
  await advancePayrollStatus(aprilRun.id, "PAID");

  console.log("Processing May 2026 payroll run (left at Calculated, for workflow demo)...");
  const mayRun = await prisma.payrollRun.create({
    data: {
      financialYearId: fy2627Id,
      payrollMonthIndex: 2,
      calendarYear: 2026,
      calendarMonth: 5,
      payrollGroup: null,
      status: "DRAFT",
      createdBy: "seed-script",
    },
  });
  await processPayrollRun(mayRun.id);

  console.log("Creating June 2026 payroll run (left as Draft, not yet processed)...");
  await prisma.payrollRun.create({
    data: {
      financialYearId: fy2627Id,
      payrollMonthIndex: 3,
      calendarYear: 2026,
      calendarMonth: 6,
      payrollGroup: null,
      status: "DRAFT",
      createdBy: "seed-script",
    },
  });

  console.log("Seed complete. Employees:", [mrA.employeeCode]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
