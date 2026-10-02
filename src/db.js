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

const SCHEMA_VERSION = 2;

function createEmptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    companies: [],
    financialYears: [],
    taxRuleSets: [],
    salaryComponents: [],
    bankFileTemplates: [],
    employees: [],
    employeeSalaryStructures: [],
    investmentDeclarations: [],
    previousEmployerIncomes: [],
    employeePerquisites: [],
    payrollRuns: [],
    importBatches: [],
    auditLog: [],
  };
}

/**
 * Brings an older saved db up to the current SCHEMA_VERSION. Safe to call on
 * every load (including a freshly restored backup file) - a no-op once the
 * db is already current.
 *   v1 -> v2: single `company` object -> `companies` array (multi-entity
 *   support); every Employee/PayrollRun gets a `companyId` backfilled to
 *   that one company; `employeePerquisites` and per-run `overrides` (LOP
 *   days / one-time taxable pay per employee) are added as empty defaults.
 */
function migrateDb(db) {
  if (!db.schemaVersion || db.schemaVersion < 2) {
    if (db.company && !db.companies) {
      const company = { ...db.company, isActive: true };
      db.companies = [company];
      for (const e of db.employees || []) e.companyId = company.id;
      for (const r of db.payrollRuns || []) r.companyId = company.id;
      delete db.company;
    }
    db.schemaVersion = 2;
  }
  if (!db.companies) db.companies = [];
  if (!db.employeePerquisites) db.employeePerquisites = [];
  for (const r of db.payrollRuns || []) {
    if (!r.overrides) r.overrides = {};
    delete r.variablePay;
  }
  return db;
}

/** Populates reference/master data (FYs, tax rules, components, bank templates) into a fresh db. Idempotent - skips anything already present by code. */
function seedMasterData(db) {
  // In Node these come from require(); in the browser rule-configs.js and
  // master-data.js are loaded as plain <script> tags before this file, so
  // their top-level consts are already visible here as bare globals. The
  // fallback object literals below must NOT redeclare a same-named local
  // (e.g. `const { TAX_RULE_CONFIGS } = { TAX_RULE_CONFIGS }`), since that
  // shadows the outer global with a same-scope binding that is still in its
  // temporal dead zone at the point the literal is evaluated - hence the
  // rename-on-destructure below.
  const ruleConfigsMod = typeof module !== "undefined" && module.exports ? require("./rule-configs.js") : { TAX_RULE_CONFIGS, FINANCIAL_YEARS };
  const masterDataMod = typeof module !== "undefined" && module.exports ? require("./master-data.js") : { SALARY_COMPONENTS, BANK_FILE_TEMPLATES };
  const { TAX_RULE_CONFIGS: taxRuleConfigs, FINANCIAL_YEARS: financialYears } = ruleConfigsMod;
  const { SALARY_COMPONENTS: salaryComponents, BANK_FILE_TEMPLATES: bankFileTemplates } = masterDataMod;

  for (const fy of financialYears) {
    if (db.financialYears.some((f) => f.code === fy.code)) continue;
    db.financialYears.push({ id: newId("fy"), code: fy.code, startDate: fy.startDate, endDate: fy.endDate, isCurrent: fy.isCurrent });
  }
  for (const cfg of taxRuleConfigs) {
    if (db.taxRuleSets.some((r) => r.financialYearCode === cfg.financialYearCode && r.regime === cfg.regime)) continue;
    db.taxRuleSets.push(JSON.parse(JSON.stringify({ id: newId("trs"), ...cfg })));
  }
  for (const c of salaryComponents) {
    if (db.salaryComponents.some((x) => x.code === c.code)) continue;
    db.salaryComponents.push({ id: newId("sc"), ...c, formula: null, isFixed: true });
  }
  for (const t of bankFileTemplates) {
    if (db.bankFileTemplates.some((x) => x.code === t.code)) continue;
    db.bankFileTemplates.push({ id: newId("bft"), ...t, isActive: true });
  }
  if (db.companies.length === 0) {
    db.companies.push({
      id: newId("co"), name: "My Company Pvt Ltd", address: "", pan: "", tan: "",
      bankName: "", bankAccountNo: "", bankIfsc: "", isActive: true, createdAt: new Date().toISOString(),
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createEmptyDb, migrateDb, seedMasterData, newId, SCHEMA_VERSION };
}
