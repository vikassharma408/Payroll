/*
  Warnings:

  - Added the required column `metrics` to the `PayrollRunLine` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PayrollRunLine" (
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
    "metrics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollRunLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PayrollRunLine" ("createdAt", "daysInMonth", "daysWorked", "deductions", "earnings", "employeeId", "employerContributions", "grossSalary", "id", "lopDays", "netSalary", "payrollRunId", "regimeUsed", "taxCalcSnapshot", "tdsMonthly", "totalDeductions", "totalEmployerCost") SELECT "createdAt", "daysInMonth", "daysWorked", "deductions", "earnings", "employeeId", "employerContributions", "grossSalary", "id", "lopDays", "netSalary", "payrollRunId", "regimeUsed", "taxCalcSnapshot", "tdsMonthly", "totalDeductions", "totalEmployerCost" FROM "PayrollRunLine";
DROP TABLE "PayrollRunLine";
ALTER TABLE "new_PayrollRunLine" RENAME TO "PayrollRunLine";
CREATE UNIQUE INDEX "PayrollRunLine_payrollRunId_employeeId_key" ON "PayrollRunLine"("payrollRunId", "employeeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
