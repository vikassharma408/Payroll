import { z } from "zod";

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const employeeSchema = z.object({
  employeeCode: z.string().min(1, "Employee code is required"),
  fullName: z.string().min(1, "Full name is required"),
  dob: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  pan: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || PAN_REGEX.test(v), "PAN must match AAAAA9999A format"),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable(),
  dateOfJoining: z.string().min(1, "Date of joining is required"),
  dateOfLeaving: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  payrollGroup: z.string().optional().nullable(),
  uan: z.string().optional().nullable(),
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(true),
  taxRegime: z.enum(["OLD", "NEW"]).default("NEW"),
  status: z.enum(["ACTIVE", "INACTIVE", "LEFT"]).default("ACTIVE"),
  isMetroCity: z.boolean().default(false),
  bankName: z.string().optional().nullable(),
  bankAccountNo: z.string().optional().nullable(),
  bankIfsc: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || IFSC_REGEX.test(v), "IFSC must match AAAA0999999 format"),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

export const investmentDeclarationSchema = z.object({
  employeeId: z.string(),
  financialYearId: z.string(),
  lic: z.coerce.number().min(0).default(0),
  epf: z.coerce.number().min(0).default(0),
  ppf: z.coerce.number().min(0).default(0),
  elss: z.coerce.number().min(0).default(0),
  lifeInsurance: z.coerce.number().min(0).default(0),
  tuitionFees: z.coerce.number().min(0).default(0),
  housingLoanPrincipal: z.coerce.number().min(0).default(0),
  otherSection80C: z.coerce.number().min(0).default(0),
  section80CCC: z.coerce.number().min(0).default(0),
  section80CCD1: z.coerce.number().min(0).default(0),
  section80CCD1B: z.coerce.number().min(0).default(0),
  section80DSelfBelow60: z.coerce.number().min(0).default(0),
  section80DParentsBelow60: z.coerce.number().min(0).default(0),
  section80DSelfAbove60: z.coerce.number().min(0).default(0),
  section80DParentsAbove60: z.coerce.number().min(0).default(0),
  section80E: z.coerce.number().min(0).default(0),
  section80EE: z.coerce.number().min(0).default(0),
  section80EEA: z.coerce.number().min(0).default(0),
  section80UBelow80: z.coerce.number().min(0).default(0),
  section80U80AndAbove: z.coerce.number().min(0).default(0),
  section80DDBelow80: z.coerce.number().min(0).default(0),
  section80DD80AndAbove: z.coerce.number().min(0).default(0),
  donations80G: z.coerce.number().min(0).default(0),
  homeLoanInterestSelfOccupied: z.coerce.number().min(0).default(0),
  letOutAnnualValue: z.coerce.number().min(0).default(0),
  letOutMunicipalTax: z.coerce.number().min(0).default(0),
  letOutHomeLoanInterest: z.coerce.number().min(0).default(0),
  monthlyRent: z.coerce.number().min(0).default(0),
  rentalAddress: z.string().optional().nullable(),
  landlordName: z.string().optional().nullable(),
  landlordPan: z.string().optional().nullable(),
  ltaClaimed: z.coerce.number().min(0).default(0),
  otherDeductions: z.coerce.number().min(0).default(0),
});

export const previousEmployerSchema = z.object({
  employeeId: z.string(),
  financialYearId: z.string(),
  employerName: z.string().min(1),
  periodFrom: z.string().min(1),
  periodTo: z.string().min(1),
  grossSalary: z.coerce.number().min(0),
  taxableSalary: z.coerce.number().min(0),
  exemptions: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  tdsDeducted: z.coerce.number().min(0).default(0),
  pfDeducted: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
});

export const salaryComponentEntrySchema = z.object({
  componentId: z.string(),
  isFormula: z.boolean(),
  formula: z.string().optional().nullable(),
  fixedAnnualAmount: z.coerce.number().optional(),
});

export const salaryStructureSchema = z.object({
  employeeId: z.string(),
  financialYearId: z.string(),
  annualCTC: z.coerce.number().min(0),
  effectiveFrom: z.string().min(1),
  entries: z.array(salaryComponentEntrySchema),
});

export const payrollRunCreateSchema = z.object({
  financialYearId: z.string(),
  payrollMonthIndex: z.coerce.number().min(1).max(12),
  payrollGroup: z.string().optional().nullable(),
});

export const adjustmentSchema = z.object({
  payrollRunLineId: z.string(),
  amount: z.coerce.number(),
  reason: z.string().min(3, "Reason is required"),
  enteredBy: z.string().min(1, "Entered-by is required"),
});
