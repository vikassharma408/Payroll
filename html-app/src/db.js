// In-browser "database": a single JSON-serializable object tree, mirroring
// the shape of the Prisma schema (prisma/schema.prisma) but denormalized
// where it's convenient for a single JS blob (salary structure components
// embedded in the structure record; payroll run lines/adjustments embedded
// in the run record) - there's no relational engine here, just plain arrays.
// This is the entire "database"; it's what gets serialized to the backup
// file and restored from it.

let _seq = 0;
function newId(prefix) {
  _seq += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}${rand}`;
}

const SCHEMA_VERSION = 1;

function createEmptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    company: {
      id: newId("co"),
      name: "My Company Pvt Ltd",
      address: "",
      pan: "",
      tan: "",
      bankName: "",
      bankAccountNo: "",
      bankIfsc: "",
    },
    financialYears: [],
    taxRuleSets: [],
    salaryComponents: [],
    bankFileTemplates: [],
    employees: [],
    employeeSalaryStructures: [],
    investmentDeclarations: [],
    previousEmployerIncomes: [],
    payrollRuns: [],
    importBatches: [],
    auditLog: [],
  };
}

/** Populates reference/master data (FYs, tax rules, components, bank templates) into a fresh db. Idempotent - skips anything already present by code. */
function seedMasterData(db) {
  const { TAX_RULE_CONFIGS, FINANCIAL_YEARS } = typeof module !== "undefined" && module.exports ? require("./rule-configs.js") : window.RuleConfigs;
  const { SALARY_COMPONENTS, BANK_FILE_TEMPLATES } = typeof module !== "undefined" && module.exports ? require("./master-data.js") : window.MasterData;

  for (const fy of FINANCIAL_YEARS) {
    if (db.financialYears.some((f) => f.code === fy.code)) continue;
    db.financialYears.push({ id: newId("fy"), code: fy.code, startDate: fy.startDate, endDate: fy.endDate, isCurrent: fy.isCurrent });
  }
  for (const cfg of TAX_RULE_CONFIGS) {
    if (db.taxRuleSets.some((r) => r.financialYearCode === cfg.financialYearCode && r.regime === cfg.regime)) continue;
    db.taxRuleSets.push(JSON.parse(JSON.stringify({ id: newId("trs"), ...cfg })));
  }
  for (const c of SALARY_COMPONENTS) {
    if (db.salaryComponents.some((x) => x.code === c.code)) continue;
    db.salaryComponents.push({ id: newId("sc"), ...c, formula: null, isFixed: true });
  }
  for (const t of BANK_FILE_TEMPLATES) {
    if (db.bankFileTemplates.some((x) => x.code === t.code)) continue;
    db.bankFileTemplates.push({ id: newId("bft"), ...t, isActive: true });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createEmptyDb, seedMasterData, newId, SCHEMA_VERSION };
}
