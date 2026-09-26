// Shared domain types. SQLite/Prisma cannot store native enums, so these
// string unions are the single source of truth for allowed values; Prisma
// columns are plain `String` and validated against these unions via zod
// (see lib/validation.ts) at every write boundary.

export type Regime = "OLD" | "NEW";

export type AgeCategory = "BELOW_60" | "SENIOR_60_79" | "SUPER_SENIOR_80_PLUS";

export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "LEFT";

export type ComponentCategory =
  | "EARNING"
  | "EMPLOYER_CONTRIBUTION"
  | "DEDUCTION";

export type Taxability = "TAXABLE" | "EXEMPT" | "PARTIALLY_EXEMPT";

export type PayrollStatus =
  | "DRAFT"
  | "CALCULATED"
  | "REVIEWED"
  | "APPROVED"
  | "LOCKED"
  | "PAID";

export const PAYROLL_STATUS_ORDER: PayrollStatus[] = [
  "DRAFT",
  "CALCULATED",
  "REVIEWED",
  "APPROVED",
  "LOCKED",
  "PAID",
];

export type ProofStatus = "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED";

export type ImportTemplateType =
  | "EMPLOYEE"
  | "SALARY_STRUCTURE"
  | "INVESTMENT"
  | "PREVIOUS_EMPLOYER"
  | "MONTHLY_PAYROLL";

// A single workbook combining Employee/Salary Structure/Investment/Previous
// Employer tabs plus an Instructions tab - the recommended one-file setup
// path. Handled separately from ImportTemplateType since it fans out into
// four of those imports rather than being a single sheet shape itself.
export const COMBINED_IMPORT_KEY = "COMBINED" as const;

// FY month index: 1 = April ... 12 = March
export const FY_MONTH_NAMES = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;

export function fyMonthIndexToCalendar(
  fyMonthIndex: number,
  fyStartYear: number,
): { calendarYear: number; calendarMonth: number } {
  // fyMonthIndex 1 (April) -> calendarMonth 4, same year as fyStartYear
  // fyMonthIndex 10 (Jan) -> calendarMonth 1, fyStartYear + 1
  const calendarMonth = ((fyMonthIndex - 1 + 3) % 12) + 1;
  const calendarYear = fyMonthIndex <= 9 ? fyStartYear : fyStartYear + 1;
  return { calendarYear, calendarMonth };
}

export interface SurchargeSlabConfig {
  threshold: number;
  rate: number;
}

export interface DeductionLimits {
  "80C": number;
  "80CCD1B": number;
  "80D_SELF_BELOW60": number;
  "80D_PARENTS_BELOW60": number;
  "80D_SELF_ABOVE60": number;
  "80D_PARENTS_ABOVE60": number;
  "80U_BELOW80": number;
  "80U_80PLUS": number;
  "80DD_BELOW80": number;
  "80DD_80PLUS": number;
  "80EE": number;
  "80EEA": number;
  HOME_LOAN_SELF_OCCUPIED: number;
  HOUSE_PROPERTY_LOSS_SETOFF: number;
}

export interface HraConfig {
  metroPercent: number;
  nonMetroPercent: number;
}

export interface TaxSlabConfig {
  ageCategory: AgeCategory;
  minIncome: number;
  maxIncome: number | null;
  rate: number;
  order: number;
}

export interface TaxRuleMeta {
  name: string;
  section: string;
  calculationMethod: string;
  limitValue?: number;
  rateValue?: number;
  assumptionWarning?: string;
}

export interface TaxRuleSetConfig {
  financialYearCode: string;
  regime: Regime;
  effectiveFrom: string; // ISO date
  standardDeduction: number;
  cessRate: number;
  rebateLimitOld: number;
  rebateMaxOld: number;
  rebateLimitNew: number;
  marginalReliefNew: boolean;
  npsEmployerCapPercent: number;
  employerNpsPfPerqLimit: number;
  surchargeConfig: SurchargeSlabConfig[]; // sorted descending by threshold
  deductionLimits: DeductionLimits;
  hraConfig: HraConfig;
  notes?: string;
  slabs: TaxSlabConfig[];
  rules: TaxRuleMeta[];
}
