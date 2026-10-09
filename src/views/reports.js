// Reports, Reconciliation, and Company Settings screens, plus small
// redirect-style views for the sidebar items that are really entered from a
// specific payroll run (Salary Register / Salary Slips / Bank Payment Files).

function redirectNote(label) {
  return (container) => {
    container.innerHTML = `<div class="card"><p class="text-muted">${label} is generated from a specific payroll run. Open a run from <a href="#/payroll-runs">Payroll Runs</a> and use the button there.</p></div>`;
  };
}
registerView("salary-register", "Payroll", "Salary Register", renderSalaryRegisterBrowser);
registerView("salary-slips", "Payroll", "Salary Slips", renderSalarySlipsBrowser);

// --- Salary Register browser: Company > Month, with a combined "All
// Companies" view per month and whole-year exports. -----------------------
function renderSalaryRegisterBrowser(container) {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const viewCompanyIds = filteredCompanyIds();
  const companies = db.companies.filter((c) => viewCompanyIds.includes(c.id));
  let selectedCompanyId = "ALL";
  let mode = "browse"; // "browse" | "combined"
  let combinedKey = null; // "YYYY-M" when mode === "combined"

  function fy() {
    return currentFy();
  }

  function runsInScope() {
    return db.payrollRuns
      .filter((r) => r.lines.length > 0 && viewCompanyIds.includes(r.companyId))
      .filter((r) => selectedCompanyId === "ALL" || r.companyId === selectedCompanyId);
  }

  function monthGroups() {
    const byMonth = new Map();
    for (const r of runsInScope()) {
      const key = `${r.calendarYear}-${r.calendarMonth}`;
      if (!byMonth.has(key)) byMonth.set(key, { key, year: r.calendarYear, month: r.calendarMonth, label: monthLabel(r), runs: [] });
      byMonth.get(key).runs.push(r);
    }
    return [...byMonth.values()].sort((a, b) => new Date(b.year, b.month - 1, 1) - new Date(a.year, a.month - 1, 1));
  }

  function exportMonth(group) {
    if (group.runs.length === 1) {
      const rows = getSalaryRegisterRows(db, group.runs[0].id);
      downloadCsv(`salary-register-${group.label.replace(/\s+/g, "-")}.csv`, SALARY_REGISTER_COLUMNS.map((c) => c[0]), rows.map((r) => SALARY_REGISTER_COLUMNS.map((c) => r[c[1]])));
      return;
    }
    const { columns, rows } = buildCombinedRegisterExport(db, group.runs, { includeMonthColumn: false, includeCompanyColumn: true });
    downloadCsv(`salary-register-all-companies-${group.label.replace(/\s+/g, "-")}.csv`, columns, rows);
  }

  function exportYear() {
    const currentFyObj = fy();
    const runs = runsInScope().filter((r) => !currentFyObj || r.financialYearId === currentFyObj.id);
    const { columns, rows } = buildCombinedRegisterExport(db, runs, { includeMonthColumn: true, includeCompanyColumn: selectedCompanyId === "ALL" });
    const scopeLabel = selectedCompanyId === "ALL" ? "all-companies" : (companies.find((c) => c.id === selectedCompanyId) || {}).name || "company";
    downloadCsv(`salary-register-fy${currentFyObj ? currentFyObj.code : ""}-${String(scopeLabel).replace(/\s+/g, "-")}.csv`, columns, rows);
  }

  function renderBrowse() {
    const groups = monthGroups();
    const rows = groups
      .map((g) => {
        const companyNames = [...new Set(g.runs.map((r) => (db.companies.find((c) => c.id === r.companyId) || {}).name || "-"))].join(", ");
        const employeeCount = g.runs.reduce((s, r) => s + r.lines.length, 0);
        const viewCell = g.runs.length === 1 ? `<a href="#/payroll-runs/${g.runs[0].id}/register"><button>View</button></a>` : `<button class="btn-view-combined" data-key="${g.key}">View Combined</button>`;
        return `<tr>
          <td>${g.label}</td>
          ${selectedCompanyId === "ALL" ? `<td>${escapeHtml(companyNames)}</td>` : ""}
          <td>${employeeCount}</td>
          <td>${viewCell}</td>
          <td><button class="btn-export-month" data-key="${g.key}">Export CSV</button></td>
        </tr>`;
      })
      .join("");

    container.innerHTML = `
      <div class="row between mt-16" style="margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <div>
          <label>Company</label>
          <select id="register-company-select">
            <option value="ALL" ${selectedCompanyId === "ALL" ? "selected" : ""}>All Companies (Combined)</option>
            ${companies.map((c) => `<option value="${c.id}" ${c.id === selectedCompanyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <button id="btn-export-year" class="primary">Export Full Year (FY ${fy() ? fy().code : "-"})</button>
      </div>
      <div class="card mt-16">
        <table>
          <thead><tr><th>Month</th>${selectedCompanyId === "ALL" ? "<th>Companies</th>" : ""}<th>Employees</th><th></th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="${selectedCompanyId === "ALL" ? 5 : 4}" class="text-muted">No processed payroll runs yet. Open <a href="#/payroll-runs">Payroll Runs</a> to run one.</td></tr>`}</tbody>
        </table>
      </div>
    `;

    document.getElementById("register-company-select").addEventListener("change", (e) => {
      selectedCompanyId = e.target.value;
      renderBrowse();
    });
    document.getElementById("btn-export-year").addEventListener("click", exportYear);
    container.querySelectorAll(".btn-export-month").forEach((btn) =>
      btn.addEventListener("click", () => {
        const group = groups.find((g) => g.key === btn.dataset.key);
        if (group) exportMonth(group);
      }),
    );
    container.querySelectorAll(".btn-view-combined").forEach((btn) =>
      btn.addEventListener("click", () => {
        combinedKey = btn.dataset.key;
        mode = "combined";
        renderCombined();
      }),
    );
  }

  function renderCombined() {
    const group = monthGroups().find((g) => g.key === combinedKey);
    if (!group) {
      mode = "browse";
      renderBrowse();
      return;
    }
    const { columns, rows } = buildCombinedRegisterExport(db, group.runs, { includeMonthColumn: false, includeCompanyColumn: true });
    container.innerHTML = `
      <div class="row between no-print">
        <button id="btn-back-to-register-browse">&larr; Back to Salary Register</button>
        <div class="row gap-8">
          <button id="btn-export-combined">Export CSV</button>
          <button id="btn-print-combined">Print</button>
        </div>
      </div>
      <div class="card mt-16">
        <h2>Salary Register - All Companies - ${group.label}</h2>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>${columns.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td>${typeof v === "number" ? rupees(v) : escapeHtml(v || "")}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById("btn-back-to-register-browse").addEventListener("click", () => {
      mode = "browse";
      renderBrowse();
    });
    document.getElementById("btn-export-combined").addEventListener("click", () => exportMonth(group));
    document.getElementById("btn-print-combined").addEventListener("click", () => window.print());
  }

  mode === "combined" ? renderCombined() : renderBrowse();
}
registerView("bank-files", "Payroll", "Bank Payment Files", redirectNote("The Bank Payment File"));

// --- Salary Slips browser: Company > Month > Employee, with search and bulk
// print/download of several payslips at once (stacked with page breaks, so
// one "Print / Save as PDF" produces a single multi-payslip PDF - this app
// has no server and no PDF library, so the browser's print-to-PDF is the
// established mechanism everywhere else a document can be saved). -----------
function renderSalarySlipsBrowser(container) {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const viewCompanyIds = filteredCompanyIds();
  const companies = db.companies.filter((c) => viewCompanyIds.includes(c.id));
  let selectedCompanyId = companies[0] ? companies[0].id : db.companies[0].id;
  let search = "";
  let selected = new Set(); // Set of payrollRunLine ids, across any month for the selected company
  let mode = "browse"; // "browse" | "print"

  function runsForCompany(companyId) {
    return db.payrollRuns
      .filter((r) => r.companyId === companyId && r.lines.length > 0)
      .sort((a, b) => new Date(b.calendarYear, b.calendarMonth - 1, 1) - new Date(a.calendarYear, a.calendarMonth - 1, 1));
  }

  function renderBrowse() {
    const runs = runsForCompany(selectedCompanyId);
    const q = search.trim().toLowerCase();
    const validLineIds = new Set(runs.flatMap((r) => r.lines.map((l) => l.id)));
    selected = new Set([...selected].filter((id) => validLineIds.has(id)));

    const monthSections = runs
      .map((run) => {
        const rowsForRun = run.lines
          .map((line) => ({ line, employee: db.employees.find((e) => e.id === line.employeeId) }))
          .filter(({ employee }) => employee)
          .filter(({ employee }) => !q || [employee.employeeCode, employee.fullName].some((v) => (v || "").toLowerCase().includes(q)))
          .sort((a, b) => a.employee.employeeCode.localeCompare(b.employee.employeeCode));
        if (rowsForRun.length === 0) return "";
        const bodyRows = rowsForRun
          .map(
            ({ line, employee }) => `
          <tr>
            <td><input type="checkbox" class="slip-select" data-line-id="${line.id}" ${selected.has(line.id) ? "checked" : ""} /></td>
            <td><a href="#/payroll-runs/${run.id}/slip/${line.id}">${escapeHtml(employee.employeeCode)}</a></td>
            <td><a href="#/payroll-runs/${run.id}/slip/${line.id}">${escapeHtml(employee.fullName)}</a></td>
            <td>${rupees(line.netSalary)}</td>
            <td><a href="#/payroll-runs/${run.id}/slip/${line.id}"><button>View</button></a></td>
          </tr>`,
          )
          .join("");
        return `
        <div class="card mt-16">
          <div class="row between"><h3>${monthLabel(run)}</h3><span class="badge neutral">${sentenceCase(run.status)}</span></div>
          <table>
            <thead><tr><th><input type="checkbox" class="month-select-all" data-run-id="${run.id}" ${rowsForRun.every(({ line }) => selected.has(line.id)) ? "checked" : ""} /></th><th>Code</th><th>Name</th><th>Net Pay</th><th></th></tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>`;
      })
      .filter(Boolean)
      .join("");

    container.innerHTML = `
      <div class="row between mt-16" style="margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <div>
          <label>Company</label>
          <select id="slip-company-select">${companies.map((c) => `<option value="${c.id}" ${c.id === selectedCompanyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
        </div>
        <span class="text-muted">${runs.length} processed payroll run(s)</span>
      </div>
      ${
        selected.size > 0
          ? `<div class="card" style="background:var(--ink); position:sticky; top:0; z-index:2;">
              <div class="row between">
                <strong>${selected.size} payslip(s) selected</strong>
                <div class="row gap-8">
                  <button id="btn-clear-slip-selection">Clear</button>
                  <button id="btn-download-selected" class="primary">Print / Save Selected as PDF</button>
                </div>
              </div>
            </div>`
          : ""
      }
      <div class="card mt-16">
        <input type="search" id="slip-search" placeholder="Search by employee code or name..." value="${escapeHtml(search)}" style="width:100%;" />
      </div>
      ${monthSections || `<div class="card mt-16 text-muted">No processed payroll runs for this company yet. Open <a href="#/payroll-runs">Payroll Runs</a> to run one.</div>`}
    `;

    document.getElementById("slip-company-select").addEventListener("change", (e) => {
      selectedCompanyId = e.target.value;
      selected.clear();
      renderBrowse();
    });
    const searchInput = document.getElementById("slip-search");
    searchInput.addEventListener("input", (e) => {
      search = e.target.value;
      renderBrowse();
      const el = document.getElementById("slip-search");
      el.focus();
      el.setSelectionRange(search.length, search.length);
    });
    container.querySelectorAll(".slip-select").forEach((cb) =>
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selected.add(cb.dataset.lineId);
        else selected.delete(cb.dataset.lineId);
        renderBrowse();
      }),
    );
    container.querySelectorAll(".month-select-all").forEach((cb) =>
      cb.addEventListener("change", (e) => {
        const run = runs.find((r) => r.id === cb.dataset.runId);
        const lineIds = run.lines
          .map((line) => ({ line, employee: db.employees.find((emp) => emp.id === line.employeeId) }))
          .filter(({ employee }) => employee && (!q || [employee.employeeCode, employee.fullName].some((v) => (v || "").toLowerCase().includes(q))))
          .map(({ line }) => line.id);
        if (e.target.checked) lineIds.forEach((id) => selected.add(id));
        else lineIds.forEach((id) => selected.delete(id));
        renderBrowse();
      }),
    );
    const clearBtn = document.getElementById("btn-clear-slip-selection");
    if (clearBtn) clearBtn.addEventListener("click", () => { selected.clear(); renderBrowse(); });
    const downloadBtn = document.getElementById("btn-download-selected");
    if (downloadBtn)
      downloadBtn.addEventListener("click", () => {
        mode = "print";
        renderPrint();
      });
  }

  function renderPrint() {
    const selections = [];
    for (const run of db.payrollRuns) {
      for (const line of run.lines) {
        if (selected.has(line.id)) selections.push({ run, line });
      }
    }
    const slipsHtml = selections.map(({ run, line }, idx) => `<div style="${idx > 0 ? "page-break-before:always;" : ""}">${buildSlipCardHtml(run, line)}</div>`).join("");
    container.innerHTML = `
      <div class="row between no-print" style="margin-bottom:16px;">
        <button id="btn-back-to-browse">&larr; Back to Salary Slips</button>
        <button id="btn-print-selected" class="primary">Print / Save as PDF</button>
      </div>
      ${slipsHtml || `<div class="card text-muted">No payslips selected.</div>`}
    `;
    document.getElementById("btn-back-to-browse").addEventListener("click", () => {
      mode = "browse";
      renderBrowse();
    });
    const printBtn = document.getElementById("btn-print-selected");
    if (printBtn) printBtn.addEventListener("click", () => window.print());
  }

  mode === "print" ? renderPrint() : renderBrowse();
}

// --- Reports ---------------------------------------------------------------
registerView("reports", "Insights", "Reports", (container) => {
  let selectedKey = REPORT_TYPES[0].key;
  let selectedRunId = "";

  function render() {
    if (db.companies.length === 0) {
      container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
      return;
    }
    const fy = currentFy();
    const viewCompanyIds = filteredCompanyIds();
    const showCompanyInLabel = viewCompanyIds.length > 1;
    const runsForFy = fy ? db.payrollRuns.filter((r) => r.financialYearId === fy.id && viewCompanyIds.includes(r.companyId)).sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex) : [];
    if (!selectedRunId || !runsForFy.some((r) => r.id === selectedRunId)) selectedRunId = runsForFy[0] ? runsForFy[0].id : "";
    const reportDef = REPORT_TYPES.find((r) => r.key === selectedKey);
    let result = { columns: [], rows: [] };
    let unavailable = "";
    if (reportDef.needsRun && !selectedRunId) unavailable = "Select a payroll run above to view this report.";
    else if (!fy) unavailable = "No Financial Year configured.";
    else result = getReportData(db, selectedKey, { runId: selectedRunId, financialYearId: fy.id, companyIds: viewCompanyIds });

    container.innerHTML = `
      <div class="card no-print">
        <div class="form-grid">
          <div><label>Report</label>
            <select id="report-select">${REPORT_TYPES.map((r) => `<option value="${r.key}" ${r.key === selectedKey ? "selected" : ""}>${r.label}</option>`).join("")}</select>
          </div>
          ${
            reportDef.needsRun
              ? `<div><label>Payroll Run</label>
                <select id="run-select">${runsForFy.map((r) => `<option value="${r.id}" ${r.id === selectedRunId ? "selected" : ""}>${monthLabel(r)}${r.payrollGroup ? " - " + r.payrollGroup : ""}${showCompanyInLabel ? ` (${(db.companies.find((c) => c.id === r.companyId) || {}).name || "-"})` : ""}</option>`).join("") || `<option value="">No runs yet</option>`}</select>
              </div>`
              : ""
          }
        </div>
      </div>
      ${
        unavailable
          ? `<div class="card text-muted">${unavailable}</div>`
          : `<div class="card">
              <div class="row between no-print" style="margin-bottom:12px;"><h2 style="margin:0;">${reportDef.label}</h2><button id="btn-export">Export CSV</button></div>
              <div style="overflow-x:auto;">
                <table>
                  <thead><tr>${result.columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
                  <tbody>${result.rows.map((row) => `<tr>${row.map((v) => `<td>${typeof v === "number" ? money(v) : escapeHtml(String(v ?? ""))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${result.columns.length}" class="text-muted">No data.</td></tr>`}</tbody>
                </table>
              </div>
            </div>`
      }
    `;

    document.getElementById("report-select").addEventListener("change", (e) => {
      selectedKey = e.target.value;
      render();
    });
    const runSelect = document.getElementById("run-select");
    if (runSelect) runSelect.addEventListener("change", (e) => { selectedRunId = e.target.value; render(); });
    const exportBtn = document.getElementById("btn-export");
    if (exportBtn) exportBtn.addEventListener("click", () => downloadCsv(`${selectedKey}.csv`, result.columns, result.rows));
  }

  render();
});

// --- Reconciliation ----------------------------------------------------
registerView("reconciliation", "Insights", "Reconciliation", (container) => {
  let currentRunId = "";
  let previousRunId = "";

  function render() {
    if (db.companies.length === 0) {
      container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
      return;
    }
    const fy = currentFy();
    const viewCompanyIds = filteredCompanyIds();
    const showCompanyInLabel = viewCompanyIds.length > 1;
    const runLabel = (r) => `${monthLabel(r)}${showCompanyInLabel ? ` (${(db.companies.find((c) => c.id === r.companyId) || {}).name || "-"})` : ""}`;
    const runs = fy ? db.payrollRuns.filter((r) => r.financialYearId === fy.id && viewCompanyIds.includes(r.companyId)).sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex) : [];
    if (!currentRunId || !runs.some((r) => r.id === currentRunId)) currentRunId = runs[0] ? runs[0].id : "";
    if (previousRunId && !runs.some((r) => r.id === previousRunId)) previousRunId = "";
    if (!previousRunId) {
      const currentRun = runs.find((r) => r.id === currentRunId);
      const prior = currentRun && runs.find((r) => r.payrollMonthIndex === currentRun.payrollMonthIndex - 1 && r.companyId === currentRun.companyId);
      previousRunId = prior ? prior.id : "";
    }

    container.innerHTML = `
      <div class="card no-print">
        <div class="form-grid">
          <div><label>Current Run</label><select id="current-run">${runs.map((r) => `<option value="${r.id}" ${r.id === currentRunId ? "selected" : ""}>${runLabel(r)}</option>`).join("")}</select></div>
          <div><label>Compare Against</label><select id="previous-run"><option value="">(none)</option>${runs.filter((r) => r.id !== currentRunId).map((r) => `<option value="${r.id}" ${r.id === previousRunId ? "selected" : ""}>${runLabel(r)}</option>`).join("")}</select></div>
        </div>
      </div>
      ${!currentRunId ? `<div class="card text-muted">No payroll runs yet.</div>` : renderComparison()}
    `;
    document.getElementById("current-run").addEventListener("change", (e) => { currentRunId = e.target.value; previousRunId = ""; render(); });
    const prevSelect = document.getElementById("previous-run");
    if (prevSelect) prevSelect.addEventListener("change", (e) => { previousRunId = e.target.value; render(); });
  }

  function renderComparison() {
    const cmp = compareRuns(db, currentRunId, previousRunId || null);
    const s = cmp.summary;
    return `
      <div class="card-grid">
        <div class="card"><div class="stat-label">Employees (Current / Previous)</div><div class="stat-value">${s.currentEmployeeCount} / ${s.previousEmployeeCount}</div></div>
        <div class="card"><div class="stat-label">New Joiners / Leavers</div><div class="stat-value">${s.newJoiners} / ${s.leavers}</div></div>
        <div class="card"><div class="stat-label">Gross Change</div><div class="stat-value ${s.currentGross >= s.previousGross ? "text-good" : "text-bad"}">${rupees(s.currentGross - s.previousGross)}</div></div>
        <div class="card"><div class="stat-label">Net Change</div><div class="stat-value ${s.currentNet >= s.previousNet ? "text-good" : "text-bad"}">${rupees(s.currentNet - s.previousNet)}</div></div>
      </div>
      <div class="card">
        <h3>Flagged Changes (&gt;10% or &gt;${rupees(10000)})</h3>
        <table>
          <thead><tr><th>Employee</th><th>Metric</th><th>Previous</th><th>Current</th><th>Change</th><th>%</th></tr></thead>
          <tbody>
            ${
              cmp.flaggedRows
                .map((r) => `<tr><td>${escapeHtml(r.employeeCode)} - ${escapeHtml(r.employeeName)}</td><td>${r.metric}</td><td>${rupees(r.previous)}</td><td>${rupees(r.current)}</td><td class="${r.change >= 0 ? "text-good" : "text-bad"}">${rupees(r.change)}</td><td>${r.changePercent === null ? "-" : r.changePercent.toFixed(1) + "%"}</td></tr>`)
                .join("") || `<tr><td colspan="6" class="text-muted">No significant changes flagged.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
  }

  render();
});

// --- Audit Log --------------------------------------------------------------
registerView("audit-log", "Insights", "Audit Log", (container) => {
  const viewCompanyIds = filteredCompanyIds();

  /** Whether a logged entry belongs to one of the filtered companies - entries for an entity type that isn't company-specific (or whose referenced entity has since been deleted) are always shown rather than silently hidden. */
  function belongsToFilteredCompanies(entry) {
    switch (entry.entityType) {
      case "Company":
        return viewCompanyIds.includes(entry.entityId);
      case "Employee": {
        const e = db.employees.find((x) => x.id === entry.entityId);
        return !e || viewCompanyIds.includes(e.companyId);
      }
      case "EmployeeSalaryStructure": {
        const s = db.employeeSalaryStructures.find((x) => x.id === entry.entityId);
        const e = s && db.employees.find((x) => x.id === s.employeeId);
        return !s || !e || viewCompanyIds.includes(e.companyId);
      }
      case "PayrollRun": {
        const r = db.payrollRuns.find((x) => x.id === entry.entityId);
        return !r || viewCompanyIds.includes(r.companyId);
      }
      case "PayrollAdjustment": {
        const run = db.payrollRuns.find((x) => x.lines.some((l) => l.id === entry.entityId));
        return !run || viewCompanyIds.includes(run.companyId);
      }
      default:
        return true;
    }
  }

  const entries = db.auditLog.filter(belongsToFilteredCompanies).slice().reverse();

  const importRows = db.importBatches
    .slice()
    .reverse()
    .map((b) => ({ createdAt: b.createdAt, entityType: "Import", action: b.templateType, detail: `${b.fileName}: ${b.importedRecords}/${b.totalRecords} imported, ${b.failedRecords} failed (${sentenceCase(b.status).toLowerCase()})` }));

  const combined = [...entries, ...importRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = `
    <div class="card">
      <p class="text-muted">A running history of key changes: employees, companies, salary structures, payroll status changes, manual adjustments, F&amp;F settlements, and imports. Scoped to ${escapeHtml(companyFilterLabel())} where the entity is company-specific.</p>
      <table>
        <thead><tr><th>When</th><th>Type</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          ${
            combined
              .slice(0, 500)
              .map((e) => `<tr><td>${formatDateDisplay(e.createdAt)} ${e.createdAt.slice(11, 16)}</td><td>${escapeHtml(e.entityType)}</td><td>${escapeHtml(sentenceCase(e.action))}</td><td>${escapeHtml(e.detail || "")}</td></tr>`)
              .join("") || `<tr><td colspan="4" class="text-muted">No activity recorded yet.</td></tr>`
          }
        </tbody>
      </table>
      ${combined.length > 500 ? `<p class="text-muted mt-16">Showing the 500 most recent of ${combined.length} entries.</p>` : ""}
    </div>
  `;
});

// Company management now lives in views/companies.js (multi-entity).
