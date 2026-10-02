// Reports, Reconciliation, and Company Settings screens, plus small
// redirect-style views for the sidebar items that are really entered from a
// specific payroll run (Salary Register / Salary Slips / Bank Payment Files).

function redirectNote(label) {
  return (container) => {
    container.innerHTML = `<div class="card"><p class="text-muted">${label} is generated from a specific payroll run. Open a run from <a href="#/payroll-runs">Payroll Runs</a> and use the button there.</p></div>`;
  };
}
registerView("salary-register", "Payroll", "Salary Register", redirectNote("The Salary Register"));
registerView("salary-slips", "Payroll", "Salary Slips", redirectNote("Salary Slips"));
registerView("bank-files", "Payroll", "Bank Payment Files", redirectNote("The Bank Payment File"));

// --- Reports ---------------------------------------------------------------
registerView("reports", "Insights", "Reports", (container) => {
  let selectedKey = REPORT_TYPES[0].key;
  let selectedRunId = "";

  function render() {
    const company = activeCompany();
    if (!company) {
      container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
      return;
    }
    const fy = currentFy();
    const runsForFy = fy ? db.payrollRuns.filter((r) => r.financialYearId === fy.id && r.companyId === company.id).sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex) : [];
    if (!selectedRunId || !runsForFy.some((r) => r.id === selectedRunId)) selectedRunId = runsForFy[0] ? runsForFy[0].id : "";
    const reportDef = REPORT_TYPES.find((r) => r.key === selectedKey);
    let result = { columns: [], rows: [] };
    let unavailable = "";
    if (reportDef.needsRun && !selectedRunId) unavailable = "Select a payroll run above to view this report.";
    else if (!fy) unavailable = "No Financial Year configured.";
    else result = getReportData(db, selectedKey, { runId: selectedRunId, financialYearId: fy.id, companyId: company.id });

    container.innerHTML = `
      <div class="card no-print">
        <div class="form-grid">
          <div><label>Report</label>
            <select id="report-select">${REPORT_TYPES.map((r) => `<option value="${r.key}" ${r.key === selectedKey ? "selected" : ""}>${r.label}</option>`).join("")}</select>
          </div>
          ${
            reportDef.needsRun
              ? `<div><label>Payroll Run</label>
                <select id="run-select">${runsForFy.map((r) => `<option value="${r.id}" ${r.id === selectedRunId ? "selected" : ""}>${monthLabel(r)}${r.payrollGroup ? " - " + r.payrollGroup : ""}</option>`).join("") || `<option value="">No runs yet</option>`}</select>
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
    const company = activeCompany();
    if (!company) {
      container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
      return;
    }
    const fy = currentFy();
    const runs = fy ? db.payrollRuns.filter((r) => r.financialYearId === fy.id && r.companyId === company.id).sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex) : [];
    if (!currentRunId || !runs.some((r) => r.id === currentRunId)) currentRunId = runs[0] ? runs[0].id : "";
    if (previousRunId && !runs.some((r) => r.id === previousRunId)) previousRunId = "";
    if (!previousRunId) {
      const currentRun = runs.find((r) => r.id === currentRunId);
      const prior = currentRun && runs.find((r) => r.payrollMonthIndex === currentRun.payrollMonthIndex - 1);
      previousRunId = prior ? prior.id : "";
    }

    container.innerHTML = `
      <div class="card no-print">
        <div class="form-grid">
          <div><label>Current Run</label><select id="current-run">${runs.map((r) => `<option value="${r.id}" ${r.id === currentRunId ? "selected" : ""}>${monthLabel(r)}</option>`).join("")}</select></div>
          <div><label>Compare Against</label><select id="previous-run"><option value="">(none)</option>${runs.filter((r) => r.id !== currentRunId).map((r) => `<option value="${r.id}" ${r.id === previousRunId ? "selected" : ""}>${monthLabel(r)}</option>`).join("")}</select></div>
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

// Company management now lives in views/companies.js (multi-entity).
