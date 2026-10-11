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

const SCHEMA_VERSION = 4;

function createEmptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    companies: [],
    financialYears: [],
    taxRuleSets: [],
    wageCeilings: [],
    salaryComponents: [],
    bankFileTemplates: [],
    ptSlabs: [],
    employees: [],
    employeeSalaryStructures: [],
    salaryStructureTemplates: [],
    investmentDeclarations: [],
    previousEmployerIncomes: [],
    employeePerquisites: [],
    payrollRuns: [],
    importBatches: [],
    auditLog: [],
    payrollSettings: { useProportionalTdsForVariablePay: false },
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
 *   v2 -> v3: `ptSlabs` (editable state-wise Professional Tax slabs) seeded
 *   from pt-slabs.js's defaults if not already present.
 *   v3 -> v4: `salaryStructureTemplates` (company-level CTC breakup rules,
 *   used to auto-generate an employee's salary structure from a target CTC)
 *   added as an empty array.
 * Runs unconditionally on every load, not just version-gated sections, so a
 * newly added field in pt-slabs.js's defaults (e.g. the senior-citizen PT
 * exemption age) backfills into an already-seeded db instead of silently
 * staying missing forever. The same unconditional pass also carries a
 * previously-set Employee.isMetroCity into that employee's current
 * Investment Declaration, since that flag moved there (it's only ever used
 * by the HRA exemption calculation, which is entirely an Investment
 * Declaration concern).
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
  if (db.schemaVersion < 3) {
    db.schemaVersion = 3;
  }
  if (db.schemaVersion < 4) {
    db.schemaVersion = 4;
  }
  if (!db.companies) db.companies = [];
  if (!db.employeePerquisites) db.employeePerquisites = [];
  if (!db.salaryStructureTemplates) db.salaryStructureTemplates = [];
  if (!db.wageCeilings) db.wageCeilings = [];
  if (!db.payrollSettings) db.payrollSettings = { useProportionalTdsForVariablePay: false };
  if (!db.ptSlabs || db.ptSlabs.length === 0) {
    const ptSlabsMod = typeof module !== "undefined" && module.exports ? require("./pt-slabs.js") : { PT_STATES };
    db.ptSlabs = JSON.parse(JSON.stringify(ptSlabsMod.PT_STATES || []));
  } else {
    const ptSlabsMod = typeof module !== "undefined" && module.exports ? require("./pt-slabs.js") : { PT_STATES };
    for (const s of db.ptSlabs) {
      const defaults = (ptSlabsMod.PT_STATES || []).find((d) => d.key === s.key);
      if (defaults && defaults.seniorExemptionAge != null && s.seniorExemptionAge == null) {
        s.seniorExemptionAge = defaults.seniorExemptionAge;
      }
    }
  }
  for (const r of db.payrollRuns || []) {
    if (!r.overrides) r.overrides = {};
    delete r.variablePay;
  }
  // Metro City moved from the Employee record to the (per-FY) Investment
  // Declaration, since it's only ever consumed by the HRA exemption
  // calculation that already lives there. Carry forward any value already
  // set on an employee into their current investment declaration (if one
  // exists) so nobody's HRA exemption silently changes after upgrading;
  // the employee's own isMetroCity field is left in place but unused.
  for (const e of db.employees || []) {
    if (!e.isMetroCity) continue;
    for (const d of db.investmentDeclarations || []) {
      if (d.employeeId === e.id && d.isMetroCity == null) d.isMetroCity = true;
    }
  }
  // Backfill the new editable Gratuity/Leave Encashment exemption ceilings
  // (Sec 19, old Sec 10(10)/10(10AA)) into any tax rule set saved before
  // they existed - same statutory defaults as a freshly seeded rule set, so
  // existing installs compute the exemption correctly instead of hitting
  // an undefined cap.
  for (const r of db.taxRuleSets || []) {
    if (!r.deductionLimits) r.deductionLimits = {};
    if (r.deductionLimits.GRATUITY_EXEMPTION == null) r.deductionLimits.GRATUITY_EXEMPTION = 2000000;
    if (r.deductionLimits.LEAVE_ENCASHMENT_EXEMPTION == null) r.deductionLimits.LEAVE_ENCASHMENT_EXEMPTION = 2500000;
  }
  // Master salary components added after an install was first seeded (e.g.
  // EMPLOYER_ESI) - seedMasterData only runs on a brand-new db.
  const masterDataMod = typeof module !== "undefined" && module.exports ? require("./master-data.js") : { SALARY_COMPONENTS };
  if (!db.salaryComponents) db.salaryComponents = [];
  for (const c of masterDataMod.SALARY_COMPONENTS || []) {
    if (db.salaryComponents.some((x) => x.code === c.code)) continue;
    db.salaryComponents.push({ id: newId("sc"), ...c, formula: null, isFixed: true });
  }
  for (const w of db.wageCeilings) {
    if (w.esiEmployeeRate == null) w.esiEmployeeRate = 0.0075;
    if (w.esiEmployerRate == null) w.esiEmployerRate = 0.0325;
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
  const masterDataMod = typeof module !== "undefined" && module.exports ? require("./master-data.js") : { SALARY_COMPONENTS, BANK_FILE_TEMPLATES, WAGE_CEILING_CONFIGS };
  const ptSlabsMod = typeof module !== "undefined" && module.exports ? require("./pt-slabs.js") : { PT_STATES };
  const { TAX_RULE_CONFIGS: taxRuleConfigs, FINANCIAL_YEARS: financialYears } = ruleConfigsMod;
  const { SALARY_COMPONENTS: salaryComponents, BANK_FILE_TEMPLATES: bankFileTemplates, WAGE_CEILING_CONFIGS: wageCeilingConfigs } = masterDataMod;

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
  for (const w of wageCeilingConfigs || []) {
    if (db.wageCeilings.some((x) => x.effectiveFrom === w.effectiveFrom)) continue;
    db.wageCeilings.push({ id: newId("wc"), ...w });
  }
  if (!db.ptSlabs || db.ptSlabs.length === 0) {
    db.ptSlabs = JSON.parse(JSON.stringify(ptSlabsMod.PT_STATES || []));
  }
  // No placeholder company is seeded here on purpose - a fresh install
  // starts with zero companies, and every screen already has a "no company
  // set up yet, add your first company" guard for that state. Auto-seeding
  // a "My Company Pvt Ltd" stub was confusing: it looked like real data and
  // had to be noticed and deleted by hand in a genuine multi-entity setup.
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createEmptyDb, migrateDb, seedMasterData, newId, SCHEMA_VERSION };
}
