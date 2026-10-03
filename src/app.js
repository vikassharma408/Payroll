// Application shell: db bootstrap, hash-based router, sidebar/topbar chrome,
// theme toggle, and the Dashboard / Tax Rules / Backup & Restore views.
// Feature screens (Employees, Payroll Runs, etc.) register themselves into
// `Views` the same way - see views/*.js.

const Views = {}; // path -> { label, section, render(container) }
function registerView(path, section, label, render) {
  Views[path] = { section, label, render };
}

const DYNAMIC_ROUTES = {}; // "employees" -> render(container, restSegments)
function registerDetailView(prefix, render) {
  DYNAMIC_ROUTES[prefix] = render;
}

let db = null;

function money(n) {
  const v = Math.round(n || 0);
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function rupees(n) {
  return `₹${money(n)}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Converts a SCREAMING_SNAKE_CASE enum/status value (ACTIVE, PROFESSIONAL_TAX,
 * SENIOR_60_79, UPTO_1600CC, ...) into a sentence-case display label, for
 * every raw status/regime/category/code shown directly to the user instead
 * of through a hand-written label map. Preserves standard tax-section/unit
 * notation (80C, 80CCD1B, 1600CC) by re-uppercasing a run of letters that
 * directly follows a digit, rather than blindly lowercasing everything.
 */
function sentenceCase(str) {
  if (!str) return "";
  let s = String(str).replace(/_/g, " ").toLowerCase();
  s = s.replace(/(\d)([a-z]+)/g, (_, d, letters) => d + letters.toUpperCase());
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Records a change in db.auditLog - call before persist() so the log entry is saved along with the change itself. */
function logAudit(entityType, entityId, action, detail) {
  db.auditLog.push({ id: newId("log"), entityType, entityId, action, detail: detail || null, createdAt: new Date().toISOString() });
}

async function persist() {
  await Persistence.saveDb(db);
  let autoSaved = false;
  try {
    autoSaved = await Persistence.writeBackupToFolder(db);
  } catch (err) {
    console.warn("Auto-save to folder failed:", err);
  }
  updateBackupStatus(autoSaved);
}

const ACTIVE_COMPANY_KEY = "activeCompanyId";
function getActiveCompanyId() {
  const stored = localStorage.getItem(ACTIVE_COMPANY_KEY);
  if (stored && db.companies.some((c) => c.id === stored)) return stored;
  return db.companies[0] ? db.companies[0].id : null;
}
function setActiveCompanyId(id) {
  localStorage.setItem(ACTIVE_COMPANY_KEY, id);
}
function activeCompany() {
  const id = getActiveCompanyId();
  return db.companies.find((c) => c.id === id) || null;
}

function renderCompanySwitcher() {
  const el = document.getElementById("company-switcher");
  if (!el) return;
  if (db.companies.length === 0) {
    el.innerHTML = `<a href="#/companies"><button>+ Add Company</button></a>`;
    return;
  }
  const activeId = getActiveCompanyId();
  el.innerHTML = `<select id="company-switcher-select">${db.companies.map((c) => `<option value="${c.id}" ${c.id === activeId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>`;
  document.getElementById("company-switcher-select").addEventListener("change", (e) => {
    setActiveCompanyId(e.target.value);
    route();
  });
}

function updateBackupStatus(justAutoSaved) {
  const el = document.getElementById("backup-status");
  if (!el) return;
  if (justAutoSaved) {
    el.textContent = `Auto-saved ${new Date().toLocaleTimeString()}`;
    el.className = "text-good";
  } else {
    el.textContent = "Saved in browser only";
    el.className = "text-muted";
  }
}

const SIDEBAR = [
  { section: "Overview", items: [["dashboard", "Dashboard"]] },
  {
    section: "Payroll",
    items: [
      ["employees", "Employees"],
      ["salary-structures", "Salary Structures"],
      ["investment-declarations", "Investment Declarations"],
      ["previous-employer", "Previous Employer Income"],
      ["payroll-runs", "Payroll Runs"],
      ["salary-register", "Salary Register"],
      ["salary-slips", "Salary Slips"],
      ["bank-files", "Bank Payment Files"],
      ["import", "Import Wizard"],
    ],
  },
  { section: "Insights", items: [["reports", "Reports"], ["reconciliation", "Reconciliation"], ["audit-log", "Audit Log"]] },
  {
    section: "Setup",
    items: [
      ["companies", "Companies"],
      ["salary-templates", "Salary Structure Templates"],
      ["tax-rules", "Tax Rules"],
      ["pt-slabs", "PT Slabs"],
      ["backup", "Backup & Restore"],
    ],
  },
];

function renderSidebar(activePath) {
  const parts = [`<div class="brand">Payroll Register</div>`];
  for (const group of SIDEBAR) {
    parts.push(`<div class="section-label">${group.section}</div>`);
    for (const [path, label] of group.items) {
      const cls = path === activePath ? "active" : "";
      parts.push(`<a href="#/${path}" class="${cls}">${label}</a>`);
    }
  }
  return parts.join("\n");
}

function currentTheme() {
  return localStorage.getItem("theme") || "dark";
}
function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
}
function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
  const segments = hash.split("/");
  document.getElementById("sidebar").innerHTML = renderSidebar(segments[0]);
  renderCompanySwitcher();
  const container = document.getElementById("content");
  container.innerHTML = "";

  if (segments.length > 1 && DYNAMIC_ROUTES[segments[0]]) {
    document.getElementById("page-title").textContent = Views[segments[0]] ? Views[segments[0]].label : segments[0];
    DYNAMIC_ROUTES[segments[0]](container, segments.slice(1));
    return;
  }
  const view = Views[segments[0]] || Views["dashboard"];
  document.getElementById("page-title").textContent = view.label;
  view.render(container);
}

function navigate(path) {
  location.hash = `#/${path}`;
}

// --- Dashboard ---------------------------------------------------------
registerView("dashboard", "Overview", "Dashboard", (container) => {
  const company = activeCompany();
  if (!company) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const companyEmployees = db.employees.filter((e) => e.companyId === company.id);
  const activeEmployees = companyEmployees.filter((e) => e.status !== "INACTIVE").length;
  const currentFy = db.financialYears.find((f) => f.isCurrent) || db.financialYears[0];
  const runsThisFy = currentFy ? db.payrollRuns.filter((r) => r.financialYearId === currentFy.id && r.companyId === company.id) : [];
  const latestRun = runsThisFy.slice().sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex)[0];
  const latestNet = latestRun ? latestRun.lines.reduce((s, l) => s + l.netSalary, 0) : 0;
  const pendingDeclarations = currentFy
    ? companyEmployees.filter((e) => e.status !== "INACTIVE" && !db.investmentDeclarations.some((d) => d.employeeId === e.id && d.financialYearId === currentFy.id)).length
    : 0;

  container.innerHTML = `
    <div class="card-grid">
      <div class="card"><div class="stat-label">Active Employees</div><div class="stat-value">${activeEmployees}</div></div>
      <div class="card"><div class="stat-label">Financial Year</div><div class="stat-value">${currentFy ? currentFy.code : "-"}</div></div>
      <div class="card"><div class="stat-label">Latest Payroll Run Net Pay</div><div class="stat-value">${rupees(latestNet)}</div></div>
      <div class="card"><div class="stat-label">Pending Investment Declarations</div><div class="stat-value ${pendingDeclarations > 0 ? "text-bad" : "text-good"}">${pendingDeclarations}</div></div>
    </div>
    <div class="card">
      <h3>Getting started</h3>
      <p class="text-muted">Add employees, define their salary structure, and process a monthly payroll run from the sidebar. Use the company switcher at the top to work on a different entity, and <a href="#/backup">Backup &amp; Restore</a> to keep your data safe - this app stores everything locally in your browser.</p>
    </div>
  `;
});

// --- Tax Rules (read-only viewer) --------------------------------------
// Percentages stored as fractions (e.g. 0.14) can print as
// "14.000000000000002%" due to ordinary floating-point binary rounding
// (0.14 has no exact binary representation) - round to 2dp for display only;
// the underlying stored/calculated value is untouched.
function pct(n) {
  return `${Math.round(n * 10000) / 100}%`;
}

registerView("tax-rules", "Setup", "Tax Rules", (container) => {
  let expandedId = null;
  let editingId = null;

  function render() {
    const rows = db.taxRuleSets
      .map(
        (r) => `
        <tr>
          <td>${r.financialYearCode}</td>
          <td>${sentenceCase(r.regime)}</td>
          <td>${r.effectiveFrom}</td>
          <td>${rupees(r.standardDeduction)}</td>
          <td>${pct(r.cessRate)}</td>
          <td>${pct(r.npsEmployerCapPercent)}</td>
          <td>${r.notes ? `<span class="badge neutral">${escapeHtml(r.notes.slice(0, 60))}${r.notes.length > 60 ? "..." : ""}</span>` : ""}</td>
          <td class="row gap-8">
            <button data-id="${r.id}" class="toggle-rule-detail">${expandedId === r.id ? "Hide" : "View full logic"}</button>
            <button data-id="${r.id}" class="toggle-rule-edit">${editingId === r.id ? "Cancel Edit" : "Edit"}</button>
          </td>
        </tr>
        ${editingId === r.id ? `<tr><td colspan="8">${renderRuleEditForm(r)}</td></tr>` : expandedId === r.id ? `<tr><td colspan="8">${renderRuleDetail(r)}</td></tr>` : ""}`,
      )
      .join("");
    container.innerHTML = `
      <div class="card">
        <p class="text-muted">These are the tax parameters built into the app for each financial year and regime - every slab, rebate, surcharge, deduction cap and HRA percentage the engine actually uses. Click "View full logic" to see everything behind a FY/regime's calculation, or "Edit" to change it when the law changes.</p>
        <p class="text-muted" style="font-size:12px;"><strong>Correcting a mistake</strong> (e.g. the provisional FY 2027-28 placeholder, once that year's real Budget is out)? Edit the rule set in place. <strong>A genuine mid-year law change?</strong> Use "Clone as new rule set" (inside Edit) with a later Effective From date instead - the engine always uses the latest rule set effective on or before the month being calculated, so earlier months keep using the old rule and nothing already paid/locked is retroactively affected.</p>
        <table>
          <thead><tr><th>FY</th><th>Regime</th><th>Effective From</th><th>Standard Deduction</th><th>Cess</th><th>Employer NPS Cap</th><th>Notes</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    container.querySelectorAll(".toggle-rule-detail").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        expandedId = expandedId === id ? null : id;
        render();
      });
    });
    container.querySelectorAll(".toggle-rule-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        editingId = editingId === id ? null : id;
        expandedId = null;
        render();
      });
    });

    const editForm = container.querySelector("#rule-edit-form");
    if (editForm) {
      const r = db.taxRuleSets.find((x) => x.id === editForm.dataset.id);

      container.querySelectorAll(".remove-slab").forEach((btn) =>
        btn.addEventListener("click", async () => {
          r.slabs.splice(Number(btn.dataset.idx), 1);
          await persist();
          render();
        }),
      );
      document.getElementById("btn-add-slab").addEventListener("click", async () => {
        const ageCategory = document.getElementById("add-slab-age").value;
        r.slabs.push({ minIncome: 0, maxIncome: null, rate: 0, order: r.slabs.length + 1, ageCategory });
        await persist();
        render();
      });
      container.querySelectorAll(".remove-surcharge").forEach((btn) =>
        btn.addEventListener("click", async () => {
          r.surchargeConfig.splice(Number(btn.dataset.idx), 1);
          await persist();
          render();
        }),
      );
      document.getElementById("btn-add-surcharge").addEventListener("click", async () => {
        r.surchargeConfig.push({ threshold: 0, rate: 0 });
        await persist();
        render();
      });

      document.getElementById("btn-clone-rule").addEventListener("click", async () => {
        const clone = JSON.parse(JSON.stringify(r));
        clone.id = newId("trs");
        const original = new Date(r.effectiveFrom);
        original.setDate(original.getDate() + 1);
        clone.effectiveFrom = original.toISOString();
        clone.notes = `Cloned from a rule set effective ${r.effectiveFrom.slice(0, 10)} - set the correct Effective From date for this amendment, then Save.`;
        db.taxRuleSets.push(clone);
        await persist();
        editingId = clone.id;
        render();
      });

      editForm.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        const fd = new FormData(evt.target);
        const errorEl = document.getElementById("rule-edit-error");
        errorEl.textContent = "";
        try {
          r.effectiveFrom = new Date(String(fd.get("effectiveFrom"))).toISOString();
          r.standardDeduction = num(fd.get("standardDeduction"));
          r.cessRate = num(fd.get("cessRate")) / 100;
          r.npsEmployerCapPercent = num(fd.get("npsEmployerCapPercent")) / 100;
          r.employerNpsPfPerqLimit = num(fd.get("employerNpsPfPerqLimit"));
          r.rebateLimitOld = num(fd.get("rebateLimitOld"));
          r.rebateMaxOld = num(fd.get("rebateMaxOld"));
          r.rebateLimitNew = num(fd.get("rebateLimitNew"));
          r.marginalReliefNew = fd.get("marginalReliefNew") === "on";
          r.hraConfig.metroPercent = num(fd.get("hraMetroPercent")) / 100;
          r.hraConfig.nonMetroPercent = num(fd.get("hraNonMetroPercent")) / 100;
          r.notes = String(fd.get("notes") || "") || null;

          container.querySelectorAll(".slab-min").forEach((el) => (r.slabs[Number(el.dataset.idx)].minIncome = num(el.value)));
          container.querySelectorAll(".slab-max").forEach((el) => (r.slabs[Number(el.dataset.idx)].maxIncome = el.value === "" ? null : num(el.value)));
          container.querySelectorAll(".slab-rate").forEach((el) => (r.slabs[Number(el.dataset.idx)].rate = num(el.value) / 100));
          container.querySelectorAll(".surcharge-threshold").forEach((el) => (r.surchargeConfig[Number(el.dataset.idx)].threshold = num(el.value)));
          container.querySelectorAll(".surcharge-rate").forEach((el) => (r.surchargeConfig[Number(el.dataset.idx)].rate = num(el.value) / 100));
          container.querySelectorAll(".deduction-limit").forEach((el) => (r.deductionLimits[el.dataset.key] = num(el.value)));

          await persist();
          editingId = null;
          render();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }
  }

  function renderRuleEditForm(r) {
    const slabRows = r.slabs
      .map(
        (s, i) => `
        <tr>
          <td>${sentenceCase(s.ageCategory)}</td>
          <td><input type="number" min="0" class="slab-min" data-idx="${i}" value="${s.minIncome}" /></td>
          <td><input type="number" min="0" class="slab-max" data-idx="${i}" value="${s.maxIncome ?? ""}" placeholder="(no limit)" /></td>
          <td><input type="number" min="0" step="0.01" class="slab-rate" data-idx="${i}" value="${s.rate * 100}" /> %</td>
          <td><button type="button" class="danger remove-slab" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");

    const surchargeRows = r.surchargeConfig
      .map(
        (s, i) => `
        <tr>
          <td><input type="number" min="0" class="surcharge-threshold" data-idx="${i}" value="${s.threshold}" /></td>
          <td><input type="number" min="0" step="0.01" class="surcharge-rate" data-idx="${i}" value="${s.rate * 100}" /> %</td>
          <td><button type="button" class="danger remove-surcharge" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");

    const deductionRows = Object.entries(r.deductionLimits)
      .map(([k, v]) => `<tr><td>${sentenceCase(k)}</td><td><input type="number" min="0" class="deduction-limit" data-key="${k}" value="${v}" /></td></tr>`)
      .join("");

    return `
      <div class="card" style="margin:8px 0;">
        <h3>Editing ${r.financialYearCode} - ${sentenceCase(r.regime)} regime</h3>
        <form id="rule-edit-form" data-id="${r.id}">
          <div class="form-grid">
            <div><label>Effective From</label><input type="date" name="effectiveFrom" value="${r.effectiveFrom.slice(0, 10)}" /></div>
            <div><label>Standard Deduction</label><input type="number" min="0" name="standardDeduction" value="${r.standardDeduction}" /></div>
            <div><label>Cess Rate (%)</label><input type="number" min="0" step="0.01" name="cessRate" value="${r.cessRate * 100}" /></div>
            <div><label>Employer NPS Cap (% of Basic+DA)</label><input type="number" min="0" step="0.01" name="npsEmployerCapPercent" value="${r.npsEmployerCapPercent * 100}" /></div>
            <div><label>Employer PF+NPS+Superannuation Perquisite Threshold</label><input type="number" min="0" name="employerNpsPfPerqLimit" value="${r.employerNpsPfPerqLimit}" /></div>
            <div><label>Rebate Limit (Old Regime)</label><input type="number" min="0" name="rebateLimitOld" value="${r.rebateLimitOld}" /></div>
            <div><label>Rebate Max Amount (Old Regime)</label><input type="number" min="0" name="rebateMaxOld" value="${r.rebateMaxOld}" /></div>
            <div><label>Rebate Limit (New Regime)</label><input type="number" min="0" name="rebateLimitNew" value="${r.rebateLimitNew}" /></div>
            <div style="display:flex;align-items:flex-end;"><label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="marginalReliefNew" ${r.marginalReliefNew ? "checked" : ""} style="width:auto;" /> Marginal relief (New Regime)</label></div>
            <div><label>HRA % (Metro)</label><input type="number" min="0" step="0.01" name="hraMetroPercent" value="${r.hraConfig.metroPercent * 100}" /></div>
            <div><label>HRA % (Non-Metro)</label><input type="number" min="0" step="0.01" name="hraNonMetroPercent" value="${r.hraConfig.nonMetroPercent * 100}" /></div>
          </div>
          <div><label class="mt-16">Notes</label><textarea name="notes" rows="2" style="width:100%;">${escapeHtml(r.notes || "")}</textarea></div>

          <h3 class="mt-16">Income Slabs</h3>
          <table><thead><tr><th>Age Category</th><th>Min Income</th><th>Max Income</th><th>Rate</th><th></th></tr></thead><tbody id="slab-rows">${slabRows}</tbody></table>
          <div class="row gap-8 mt-16">
            <select id="add-slab-age">
              <option value="BELOW_60">BELOW 60</option>
              <option value="SENIOR_60_79">SENIOR 60-79</option>
              <option value="SUPER_SENIOR_80_PLUS">SUPER SENIOR 80+</option>
            </select>
            <button type="button" id="btn-add-slab">+ Add Slab Row</button>
          </div>

          <h3 class="mt-16">Surcharge</h3>
          <table><thead><tr><th>Threshold</th><th>Rate</th><th></th></tr></thead><tbody id="surcharge-rows">${surchargeRows}</tbody></table>
          <div class="row gap-8 mt-16"><button type="button" id="btn-add-surcharge">+ Add Surcharge Row</button></div>

          <h3 class="mt-16">Chapter VI-A Deduction Limits</h3>
          <table><thead><tr><th>Section</th><th>Limit</th></tr></thead><tbody>${deductionRows}</tbody></table>

          <p class="text-muted mt-16" style="font-size:12px;">Note: edits here never change already-calculated payroll lines (their tax snapshot is frozen at calculation time) - only future (re)calculations use the new values. The "Full Rule Catalog" reference text in "View full logic" may not reflect an edit until you reopen it; the figures and tables on this edit screen are always current.</p>

          <div id="rule-edit-error" class="text-bad mt-16"></div>
          <div class="row gap-8 mt-16">
            <button type="submit" class="primary">Save</button>
            <button type="button" id="btn-clone-rule">Clone as New Rule Set</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderRuleDetail(r) {
    const byAge = new Map();
    for (const slab of r.slabs) {
      if (!byAge.has(slab.ageCategory)) byAge.set(slab.ageCategory, []);
      byAge.get(slab.ageCategory).push(slab);
    }
    const slabsHtml = [...byAge.entries()]
      .map(
        ([age, slabs]) => `
        <div class="mt-16">
          <strong>${sentenceCase(age)}</strong>
          <table>
            <thead><tr><th>Income Band</th><th>Rate</th></tr></thead>
            <tbody>${slabs
              .sort((a, b) => a.order - b.order)
              .map((s) => `<tr><td>${rupees(s.minIncome)} - ${s.maxIncome == null ? "and above" : rupees(s.maxIncome)}</td><td>${pct(s.rate)}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>`,
      )
      .join("");

    const surchargeRows = r.surchargeConfig
      .slice()
      .sort((a, b) => b.threshold - a.threshold)
      .map((s) => `<tr><td>Taxable income &gt; ${rupees(s.threshold)}</td><td>${pct(s.rate)}</td></tr>`)
      .join("");

    const deductionRows = Object.entries(r.deductionLimits)
      .map(([k, v]) => `<tr><td>${sentenceCase(k)}</td><td>${rupees(v)}</td></tr>`)
      .join("");

    const rulesRows = r.rules
      .map(
        (rule) => `
        <tr>
          <td>${escapeHtml(rule.name)}</td>
          <td>${escapeHtml(rule.section)}</td>
          <td>${escapeHtml(rule.calculationMethod)}</td>
          <td>${rule.limitValue != null ? rupees(rule.limitValue) : "-"}</td>
          <td>${rule.rateValue != null ? (rule.rateValue < 1 ? pct(rule.rateValue) : rule.rateValue) : "-"}</td>
        </tr>
        ${rule.assumptionWarning ? `<tr><td colspan="5" class="text-muted" style="font-size:12px;">&#9888; ${escapeHtml(rule.assumptionWarning)}</td></tr>` : ""}`,
      )
      .join("");

    return `
      <div class="card" style="margin:8px 0;">
        <div class="card-grid">
          <div><div class="stat-label">Rebate (Old Regime, Sec 156 / old 87A)</div><div>Up to ${rupees(r.rebateMaxOld)} if taxable income &le; ${rupees(r.rebateLimitOld)}</div></div>
          <div><div class="stat-label">Rebate (New Regime, Sec 156 / old 87A)</div><div>Full rebate if taxable income &le; ${rupees(r.rebateLimitNew)}${r.marginalReliefNew ? ", with marginal relief just above it" : ""}</div></div>
          <div><div class="stat-label">HRA Exemption (old Sec 10(13A), now a Schedule)</div><div>${pct(r.hraConfig.metroPercent)} of Basic+DA (metro) / ${pct(r.hraConfig.nonMetroPercent)} (non-metro)</div></div>
          <div><div class="stat-label">Employer PF+NPS+Superannuation Perquisite Threshold (Sec 17 / old 17(2)(vii))</div><div>${rupees(r.employerNpsPfPerqLimit)}/year combined</div></div>
        </div>

        <h3 class="mt-16">Income Slabs by Age Category</h3>
        ${slabsHtml}

        <h3 class="mt-16">Surcharge (with marginal relief)</h3>
        <table><thead><tr><th>Threshold</th><th>Rate</th></tr></thead><tbody>${surchargeRows}</tbody></table>

        <h3 class="mt-16">Chapter VI-A Deduction Limits</h3>
        <table><thead><tr><th>Section</th><th>Limit</th></tr></thead><tbody>${deductionRows}</tbody></table>

        <h3 class="mt-16">Full Rule Catalog</h3>
        <table>
          <thead><tr><th>Rule</th><th>Section</th><th>Calculation Method</th><th>Limit</th><th>Rate</th></tr></thead>
          <tbody>${rulesRows}</tbody>
        </table>
      </div>
    `;
  }

  render();
});

// --- PT Slabs (editable, state-wise Professional Tax) ---------------------
registerView("pt-slabs", "Setup", "PT Slabs", (container) => {
  let editingKey = null;

  function render() {
    const rows = db.ptSlabs
      .map(
        (s) => `
        <tr>
          <td>${s.label}</td>
          <td>${sentenceCase(s.type)}</td>
          <td>${s.type === "MONTHLY" || s.type === "HALF_YEARLY" ? `up to ${rupees(s.slabs[s.slabs.length - 1].amount)}/month` : s.type === "FLAT" ? `${rupees(s.amount)}/month` : "-"}</td>
          <td>${s.seniorExemptionAge != null ? `${s.seniorExemptionAge}+` : "-"}</td>
          <td><button data-key="${s.key}" class="toggle-pt-edit">${editingKey === s.key ? "Cancel" : "Edit"}</button></td>
        </tr>
        ${editingKey === s.key ? `<tr><td colspan="5">${renderPtEditForm(s)}</td></tr>` : ""}`,
      )
      .join("");
    container.innerHTML = `
      <div class="card">
        <p class="text-muted">Professional Tax is levied under each state's own Act, so rates and thresholds vary by state - several states (Delhi, UP, Haryana, Rajasthan, Himachal Pradesh) levy none at all. Assign an employee's state (and date of birth) on their Profile tab to auto-compute their monthly PT from gross salary instead of a fixed amount; leave state unset to keep using the Salary Structure's fixed PT component. Several states also fully exempt employees once they cross a certain age regardless of salary (e.g. Maharashtra and Gujarat at 65, Karnataka at 60) - set "Senior Citizen Exemption Age" below if a state you use has one; it's left blank for states we couldn't confirm an exact age for. Edit a state's slabs below if a rate changes.</p>
        <table>
          <thead><tr><th>State</th><th>Type</th><th>Top Rate</th><th>Senior Exemption</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    container.querySelectorAll(".toggle-pt-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        editingKey = editingKey === btn.dataset.key ? null : btn.dataset.key;
        render();
      }),
    );
  }

  function renderPtEditForm(s) {
    const slabRows = (s.slabs || [])
      .map(
        (slab, i) => `
        <tr>
          <td><input type="number" min="0" class="pt-slab-upto" data-idx="${i}" value="${slab.upTo ?? ""}" placeholder="(no limit - top band)" /></td>
          <td><input type="number" min="0" step="0.01" class="pt-slab-amount" data-idx="${i}" value="${slab.amount}" /></td>
          <td><button type="button" class="danger remove-pt-slab" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");
    return `
      <div class="card" style="margin:8px 0;">
        <form id="pt-edit-form" data-key="${s.key}">
          <div class="form-grid">
            <div><label>Type</label>
              <select name="type">
                ${["MONTHLY", "HALF_YEARLY", "FLAT", "NONE", "MANUAL"].map((t) => `<option value="${t}" ${s.type === t ? "selected" : ""}>${sentenceCase(t)}</option>`).join("")}
              </select>
            </div>
            <div><label>Flat Monthly Amount (only used if Type = FLAT)</label><input type="number" min="0" name="amount" value="${s.amount || 0}" /></div>
            <div><label>Senior Citizen Exemption Age (optional)</label><input type="number" min="0" name="seniorExemptionAge" value="${s.seniorExemptionAge ?? ""}" placeholder="e.g. 65 - leave blank if none" /></div>
          </div>
          <div><label class="mt-16">Note</label><textarea name="note" rows="2" style="width:100%;">${escapeHtml(s.note || "")}</textarea></div>
          <h3 class="mt-16">Slabs ${s.type === "HALF_YEARLY" ? "(on half-yearly gross; monthly PT = slab amount / 6)" : "(on monthly gross)"}</h3>
          <table><thead><tr><th>Up To (leave blank for the top/last band)</th><th>Amount</th><th></th></tr></thead><tbody id="pt-slab-rows">${slabRows}</tbody></table>
          <div class="row gap-8 mt-16"><button type="button" id="btn-add-pt-slab">+ Add Slab Row</button></div>
          <div id="pt-edit-error" class="text-bad mt-16"></div>
          <div class="row gap-8 mt-16"><button type="submit" class="primary">Save</button></div>
        </form>
      </div>
    `;
  }

  container.addEventListener("click", async (evt) => {
    if (evt.target.id === "btn-add-pt-slab") {
      const s = db.ptSlabs.find((x) => x.key === editingKey);
      if (!s.slabs) s.slabs = [];
      s.slabs.push({ upTo: null, amount: 0 });
      await persist();
      render();
    } else if (evt.target.classList.contains("remove-pt-slab")) {
      const s = db.ptSlabs.find((x) => x.key === editingKey);
      s.slabs.splice(Number(evt.target.dataset.idx), 1);
      await persist();
      render();
    }
  });

  container.addEventListener("submit", async (evt) => {
    if (evt.target.id !== "pt-edit-form") return;
    evt.preventDefault();
    const s = db.ptSlabs.find((x) => x.key === evt.target.dataset.key);
    const fd = new FormData(evt.target);
    s.type = String(fd.get("type"));
    s.amount = num(fd.get("amount"));
    s.note = String(fd.get("note") || "") || null;
    const seniorAgeRaw = String(fd.get("seniorExemptionAge") || "").trim();
    s.seniorExemptionAge = seniorAgeRaw === "" ? null : num(seniorAgeRaw);
    container.querySelectorAll(".pt-slab-upto").forEach((el) => {
      const row = s.slabs[Number(el.dataset.idx)];
      row.upTo = el.value === "" ? null : num(el.value);
    });
    container.querySelectorAll(".pt-slab-amount").forEach((el) => {
      s.slabs[Number(el.dataset.idx)].amount = num(el.value);
    });
    await persist();
    editingKey = null;
    render();
  });

  render();
});

// --- Backup & Restore ----------------------------------------------------
registerView("backup", "Setup", "Backup & Restore", (container) => {
  render();

  async function render() {
    const folderHandle = await Persistence.getRememberedFolderHandle().catch(() => null);
    const supportsFolder = Persistence.hasFileSystemAccess();
    container.innerHTML = `
      <div class="card">
        <h3>Manual backup</h3>
        <p class="text-muted">Download a full copy of your data (employees, salary structures, declarations, payroll runs, everything) as a JSON file. Keep it somewhere safe.</p>
        <div class="row gap-8">
          <button class="primary" id="btn-download-backup">Download backup now</button>
        </div>
      </div>
      <div class="card">
        <h3>Restore from backup</h3>
        <p class="text-muted">Replaces all data currently in this browser with the contents of the selected backup file. This cannot be undone - download a current backup first if you want to keep it.</p>
        <div class="row gap-8">
          <input type="file" id="restore-file-input" accept="application/json" />
        </div>
      </div>
      <div class="card">
        <h3>Auto-save to a folder</h3>
        <p class="text-muted">Choose a folder once, and every change you make will be automatically written to <code>${Persistence.BACKUP_FILE_NAME}</code> in that folder - no need to remember to download a backup.</p>
        ${
          supportsFolder
            ? `<div class="row gap-8">
                <button class="primary" id="btn-pick-folder">${folderHandle ? "Change auto-save folder" : "Choose auto-save folder"}</button>
                ${folderHandle ? `<button class="danger" id="btn-forget-folder">Stop auto-saving</button>` : ""}
              </div>
              <p class="text-muted mt-16">${folderHandle ? `Currently auto-saving to a chosen folder.` : `No folder chosen yet - changes are only saved in this browser.`}</p>`
            : `<p class="text-bad">Your browser doesn't support folder auto-save (this needs Chrome or Edge). Use manual download/restore instead.</p>`
        }
      </div>
    `;

    document.getElementById("btn-download-backup").addEventListener("click", () => Persistence.downloadBackupFile(db));

    document.getElementById("restore-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("This will replace all data currently in this browser with the selected backup file. Continue?")) {
        e.target.value = "";
        return;
      }
      try {
        const restored = await Persistence.restoreFromFile(file);
        db = migrateDb(restored);
        await Persistence.saveDb(db);
        alert("Backup restored successfully.");
        route();
      } catch (err) {
        alert(`Restore failed: ${err.message}`);
      }
      e.target.value = "";
    });

    const pickBtn = document.getElementById("btn-pick-folder");
    if (pickBtn) {
      pickBtn.addEventListener("click", async () => {
        try {
          await Persistence.pickBackupFolder();
          await Persistence.writeBackupToFolder(db);
          await render();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    const forgetBtn = document.getElementById("btn-forget-folder");
    if (forgetBtn) {
      forgetBtn.addEventListener("click", async () => {
        await Persistence.forgetBackupFolder();
        await render();
      });
    }
  }
});

// NOTE: the placeholder-fill loop and the boot() call live in bootstrap.js,
// which is loaded last (after every views/*.js file) so real views have a
// chance to register themselves - via registerView() - before any gaps are
// placeholder-filled and before the initial route() render happens.
