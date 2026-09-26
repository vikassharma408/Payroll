-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "pan" TEXT,
    "tan" TEXT,
    "logoUrl" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "TaxRuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "financialYearId" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "standardDeduction" INTEGER NOT NULL,
    "cessRate" REAL NOT NULL,
    "rebateLimitOld" INTEGER NOT NULL,
    "rebateMaxOld" INTEGER NOT NULL,
    "rebateLimitNew" INTEGER NOT NULL,
    "marginalReliefNew" BOOLEAN NOT NULL DEFAULT true,
    "npsEmployerCapPercent" REAL NOT NULL,
    "employerNpsPfPerqLimit" INTEGER NOT NULL,
    "surchargeConfig" TEXT NOT NULL,
    "deductionLimits" TEXT NOT NULL,
    "hraConfig" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "TaxRuleSet_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxSlab" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxRuleSetId" TEXT NOT NULL,
    "ageCategory" TEXT NOT NULL,
    "minIncome" INTEGER NOT NULL,
    "maxIncome" INTEGER,
    "rate" REAL NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "TaxSlab_taxRuleSetId_fkey" FOREIGN KEY ("taxRuleSetId") REFERENCES "TaxRuleSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxRuleSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "limitValue" REAL,
    "rateValue" REAL,
    "assumptionWarning" TEXT,
    CONSTRAINT "TaxRule_taxRuleSetId_fkey" FOREIGN KEY ("taxRuleSetId") REFERENCES "TaxRuleSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dob" DATETIME,
    "gender" TEXT,
    "pan" TEXT,
    "aadhaar" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "dateOfJoining" DATETIME NOT NULL,
    "dateOfLeaving" DATETIME,
    "department" TEXT,
    "designation" TEXT,
    "location" TEXT,
    "costCentre" TEXT,
    "payrollGroup" TEXT,
    "uan" TEXT,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "ptApplicable" BOOLEAN NOT NULL DEFAULT true,
    "taxRegime" TEXT NOT NULL DEFAULT 'NEW',
    "ageCategory" TEXT NOT NULL DEFAULT 'BELOW_60',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "isMetroCity" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "taxability" TEXT NOT NULL DEFAULT 'TAXABLE',
    "formula" TEXT,
    "isFixed" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "EmployeeSalaryStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "annualCTC" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeSalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EmployeeSalaryStructure_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmployeeSalaryComponentValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "structureId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "monthlyAmount" REAL NOT NULL,
    "annualAmount" REAL NOT NULL,
    "formulaUsed" TEXT,
    CONSTRAINT "EmployeeSalaryComponentValue_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "EmployeeSalaryStructure" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmployeeSalaryComponentValue_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SalaryComponent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvestmentDeclaration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "lic" REAL NOT NULL DEFAULT 0,
    "epf" REAL NOT NULL DEFAULT 0,
    "ppf" REAL NOT NULL DEFAULT 0,
    "elss" REAL NOT NULL DEFAULT 0,
    "lifeInsurance" REAL NOT NULL DEFAULT 0,
    "tuitionFees" REAL NOT NULL DEFAULT 0,
    "housingLoanPrincipal" REAL NOT NULL DEFAULT 0,
    "otherSection80C" REAL NOT NULL DEFAULT 0,
    "section80CCC" REAL NOT NULL DEFAULT 0,
    "section80CCD1" REAL NOT NULL DEFAULT 0,
    "section80CCD1B" REAL NOT NULL DEFAULT 0,
    "section80DSelfBelow60" REAL NOT NULL DEFAULT 0,
    "section80DParentsBelow60" REAL NOT NULL DEFAULT 0,
    "section80DSelfAbove60" REAL NOT NULL DEFAULT 0,
    "section80DParentsAbove60" REAL NOT NULL DEFAULT 0,
    "section80E" REAL NOT NULL DEFAULT 0,
    "section80EE" REAL NOT NULL DEFAULT 0,
    "section80EEA" REAL NOT NULL DEFAULT 0,
    "section80UBelow80" REAL NOT NULL DEFAULT 0,
    "section80U80AndAbove" REAL NOT NULL DEFAULT 0,
    "section80DDBelow80" REAL NOT NULL DEFAULT 0,
    "section80DD80AndAbove" REAL NOT NULL DEFAULT 0,
    "donations80G" REAL NOT NULL DEFAULT 0,
    "homeLoanInterestSelfOccupied" REAL NOT NULL DEFAULT 0,
    "letOutAnnualValue" REAL NOT NULL DEFAULT 0,
    "letOutMunicipalTax" REAL NOT NULL DEFAULT 0,
    "letOutHomeLoanInterest" REAL NOT NULL DEFAULT 0,
    "monthlyRent" REAL NOT NULL DEFAULT 0,
    "rentalAddress" TEXT,
    "landlordName" TEXT,
    "landlordPan" TEXT,
    "ltaClaimed" REAL NOT NULL DEFAULT 0,
    "otherDeductions" REAL NOT NULL DEFAULT 0,
    "proofStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvestmentDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvestmentDeclaration_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PreviousEmployerIncome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "grossSalary" REAL NOT NULL,
    "taxableSalary" REAL NOT NULL,
    "exemptions" REAL NOT NULL DEFAULT 0,
    "deductions" REAL NOT NULL DEFAULT 0,
    "tdsDeducted" REAL NOT NULL DEFAULT 0,
    "pfDeducted" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreviousEmployerIncome_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PreviousEmployerIncome_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "financialYearId" TEXT NOT NULL,
    "payrollMonthIndex" INTEGER NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "calendarMonth" INTEGER NOT NULL,
    "payrollGroup" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "processedAt" DATETIME,
    "reviewedAt" DATETIME,
    "approvedAt" DATETIME,
    "lockedAt" DATETIME,
    "paidAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollRun_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollRunLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "daysInMonth" INTEGER NOT NULL,
    "daysWorked" REAL NOT NULL,
    "lopDays" REAL NOT NULL DEFAULT 0,
    "earnings" TEXT NOT NULL,
    "grossSalary" REAL NOT NULL,
    "employerContributions" TEXT NOT NULL,
    "totalEmployerCost" REAL NOT NULL,
    "deductions" TEXT NOT NULL,
    "tdsMonthly" REAL NOT NULL,
    "totalDeductions" REAL NOT NULL,
    "netSalary" REAL NOT NULL,
    "regimeUsed" TEXT NOT NULL,
    "taxCalcSnapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollRunLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollRunLineId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollAdjustment_payrollRunLineId_fkey" FOREIGN KEY ("payrollRunLineId") REFERENCES "PayrollRunLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankFileTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "columns" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT ',',
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL,
    "importedRecords" INTEGER NOT NULL,
    "failedRecords" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    CONSTRAINT "ImportError_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_code_key" ON "FinancialYear"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleSet_financialYearId_regime_effectiveFrom_key" ON "TaxRuleSet"("financialYearId", "regime", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryComponent_code_key" ON "SalaryComponent"("code");

-- CreateIndex
CREATE INDEX "EmployeeSalaryStructure_employeeId_financialYearId_idx" ON "EmployeeSalaryStructure"("employeeId", "financialYearId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentDeclaration_employeeId_financialYearId_key" ON "InvestmentDeclaration"("employeeId", "financialYearId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_financialYearId_payrollMonthIndex_payrollGroup_key" ON "PayrollRun"("financialYearId", "payrollMonthIndex", "payrollGroup");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunLine_payrollRunId_employeeId_key" ON "PayrollRunLine"("payrollRunId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BankFileTemplate_code_key" ON "BankFileTemplate"("code");
