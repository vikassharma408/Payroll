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
  { section: "Insights", items: [["reports", "Reports"], ["reconciliation", "Reconciliation"]] },
  {
    section: "Setup",
    items: [
      ["companies", "Companies"],
      ["tax-rules", "Tax Rules"],
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

  function render() {
    const rows = db.taxRuleSets
      .map(
        (r) => `
        <tr>
          <td>${r.financialYearCode}</td>
          <td>${r.regime}</td>
          <td>${r.effectiveFrom}</td>
          <td>${rupees(r.standardDeduction)}</td>
          <td>${pct(r.cessRate)}</td>
          <td>${pct(r.npsEmployerCapPercent)}</td>
          <td>${r.notes ? `<span class="badge neutral">${escapeHtml(r.notes.slice(0, 60))}${r.notes.length > 60 ? "..." : ""}</span>` : ""}</td>
          <td><button data-id="${r.id}" class="toggle-rule-detail">${expandedId === r.id ? "Hide" : "View full logic"}</button></td>
        </tr>
        ${expandedId === r.id ? `<tr><td colspan="8">${renderRuleDetail(r)}</td></tr>` : ""}`,
      )
      .join("");
    container.innerHTML = `
      <div class="card">
        <p class="text-muted">These are the tax parameters built into the app for each financial year and regime - every slab, rebate, surcharge, deduction cap and HRA percentage the engine actually uses. Click "View full logic" on any row to see everything behind that FY/regime's calculation. They are not editable from the UI - this keeps the calculations auditable and consistent with the underlying tax law research.</p>
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
          <strong>${age.replace(/_/g, " ")}</strong>
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
      .map(([k, v]) => `<tr><td>${k.replace(/_/g, " ")}</td><td>${rupees(v)}</td></tr>`)
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
          <div><div class="stat-label">Rebate (Old Regime, Sec 87A)</div><div>Up to ${rupees(r.rebateMaxOld)} if taxable income &le; ${rupees(r.rebateLimitOld)}</div></div>
          <div><div class="stat-label">Rebate (New Regime, Sec 87A)</div><div>Full rebate if taxable income &le; ${rupees(r.rebateLimitNew)}${r.marginalReliefNew ? ", with marginal relief just above it" : ""}</div></div>
          <div><div class="stat-label">HRA Exemption (Sec 10(13A))</div><div>${pct(r.hraConfig.metroPercent)} of Basic+DA (metro) / ${pct(r.hraConfig.nonMetroPercent)} (non-metro)</div></div>
          <div><div class="stat-label">Employer PF+NPS+Superannuation Perquisite Threshold (Sec 17(2)(vii))</div><div>${rupees(r.employerNpsPfPerqLimit)}/year combined</div></div>
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
