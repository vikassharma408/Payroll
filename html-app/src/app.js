// Application shell: db bootstrap, hash-based router, sidebar/topbar chrome,
// theme toggle, and the Dashboard / Tax Rules / Backup & Restore views.
// Feature screens (Employees, Payroll Runs, etc.) register themselves into
// `Views` the same way - see views/*.js.

const Views = {}; // path -> { label, section, render(container) }
function registerView(path, section, label, render) {
  Views[path] = { section, label, render };
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
      ["tax-rules", "Tax Rules"],
      ["company-settings", "Company Settings"],
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
  const view = Views[hash] || Views["dashboard"];
  document.getElementById("sidebar").innerHTML = renderSidebar(hash);
  document.getElementById("page-title").textContent = view.label;
  const container = document.getElementById("content");
  container.innerHTML = "";
  view.render(container);
}

function navigate(path) {
  location.hash = `#/${path}`;
}

// --- Dashboard ---------------------------------------------------------
registerView("dashboard", "Overview", "Dashboard", (container) => {
  const activeEmployees = db.employees.filter((e) => e.status !== "INACTIVE").length;
  const currentFy = db.financialYears.find((f) => f.isCurrent) || db.financialYears[0];
  const runsThisFy = currentFy ? db.payrollRuns.filter((r) => r.financialYearId === currentFy.id) : [];
  const latestRun = runsThisFy.slice().sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex)[0];
  const latestNet = latestRun ? latestRun.lines.reduce((s, l) => s + l.netSalary, 0) : 0;
  const pendingDeclarations = currentFy
    ? db.employees.filter((e) => e.status !== "INACTIVE" && !db.investmentDeclarations.some((d) => d.employeeId === e.id && d.financialYearId === currentFy.id)).length
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
      <p class="text-muted">Add employees, define their salary structure, and process a monthly payroll run from the sidebar. Use <a href="#/backup">Backup &amp; Restore</a> to keep your data safe - this app stores everything locally in your browser.</p>
    </div>
  `;
});

// --- Tax Rules (read-only viewer) --------------------------------------
registerView("tax-rules", "Setup", "Tax Rules", (container) => {
  const rows = db.taxRuleSets
    .map(
      (r) => `
      <tr>
        <td>${r.financialYearCode}</td>
        <td>${r.regime}</td>
        <td>${r.effectiveFrom}</td>
        <td>${rupees(r.standardDeduction)}</td>
        <td>${(r.cessRate * 100).toFixed(0)}%</td>
        <td>${r.npsEmployerCapPercent * 100}%</td>
        <td>${r.notes ? `<span class="badge neutral">${escapeHtml(r.notes.slice(0, 60))}${r.notes.length > 60 ? "..." : ""}</span>` : ""}</td>
      </tr>`,
    )
    .join("");
  container.innerHTML = `
    <div class="card">
      <p class="text-muted">These are the tax parameters built into the app for each financial year and regime. They are not editable from the UI - this keeps the calculations auditable and consistent with the underlying tax law research.</p>
      <table>
        <thead><tr><th>FY</th><th>Regime</th><th>Effective From</th><th>Standard Deduction</th><th>Cess</th><th>Employer NPS Cap</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
        db = restored;
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

// --- Placeholder for not-yet-built screens --------------------------------
function registerPlaceholder(path, section, label) {
  registerView(path, section, label, (container) => {
    container.innerHTML = `<div class="card"><p class="text-muted">${label} screen is coming in the next update.</p></div>`;
  });
}
for (const group of SIDEBAR) {
  for (const [path, label] of group.items) {
    if (!Views[path]) registerPlaceholder(path, group.section, label);
  }
}

// --- Boot ------------------------------------------------------------------
async function boot() {
  applyTheme(currentTheme());
  document.getElementById("theme-toggle-btn").addEventListener("click", toggleTheme);

  const loaded = await Persistence.loadDb();
  if (loaded) {
    db = loaded;
  } else {
    db = createEmptyDb();
    seedMasterData(db);
    await Persistence.saveDb(db);
  }

  window.addEventListener("hashchange", route);
  route();
  updateBackupStatus(false);
}

boot();
