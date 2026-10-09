// Payroll Runs: create a run, calculate it, advance its workflow status,
// inspect each employee's payslip line, and record manual adjustments.
// Mirrors app/payroll/page.tsx + app/payroll/[id]/page.tsx from the Next.js
// version, backed by the ported html-app/src/payroll-engine.js.

registerView("payroll-runs", "Payroll", "Payroll Runs", renderPayrollRunsList);
registerDetailView("payroll-runs", (container, segments) => {
  const [runId, sub, lineId] = segments;
  if (sub === "register") return renderSalaryRegister(container, runId);
  if (sub === "bank-file") return renderBankFile(container, runId);
  if (sub === "slip" && lineId) return renderSalarySlip(container, runId, lineId);
  if (sub === "line" && lineId) return renderPayrollLineDetailPage(container, runId, lineId);
  renderPayrollRunDetail(container, runId);
});

function monthLabel(run) {
  const name = FY_MONTH_NAMES[run.payrollMonthIndex - 1];
  return `${name} ${run.calendarYear}`;
}

// A component-wise arrears top-up (see PayrollEngine.applyArrears /
// ARREARS_CODE_SUFFIX) is a distinct earning code like "BASIC__ARREARS" so
// it stays a separate payslip line rather than merging into that month's
// own Basic figure - this unwraps it back to a human label, e.g. "Basic
// Salary (Arrears)", reusing whatever label the base code already has.
// Declared at true top level (not nested in a render function) since it's
// also called from employees.js's Arrears panel and from renderSalarySlip
// below, both outside whichever render function originally needed it.
function componentLabel(code) {
  if (code.endsWith(PayrollEngine.ARREARS_CODE_SUFFIX)) {
    const baseCode = code.slice(0, -PayrollEngine.ARREARS_CODE_SUFFIX.length);
    return `${SLIP_COMPONENT_LABELS[baseCode] || sentenceCase(baseCode)} (Arrears)`;
  }
  return SLIP_COMPONENT_LABELS[code] || sentenceCase(code);
}

// Which Legal Entities are checked in the Create Payroll Run panel, kept
// at module level (not a local inside renderPayrollRunsList) because
// renderContent() re-invokes that function from scratch after creating
// run(s) - a local variable would reset every time, snapping the checkbox
// state back to a single company (see getActiveCompanyId() below) and
// making a genuine "All Companies" selection look like it had silently
// collapsed to just the first one. null means "no explicit selection yet
// this session" - falls back to whichever company is currently active.
let lastSelectedRunCompanyIds = null;

// Registered once (not inside renderPayrollRunsList, which re-runs on every
// visit to this page) so outside clicks close the Create Payroll Run Legal
// Entity panel without ever accumulating duplicate listeners.
document.addEventListener("click", (e) => {
  const panel = document.getElementById("run-company-panel");
  const btn = document.getElementById("run-company-btn");
  if (panel && panel.style.display === "block" && !panel.contains(e.target) && e.target !== btn) {
    panel.style.display = "none";
  }
});

function renderPayrollRunsList(container) {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const fy = currentFy();
  const viewCompanyIds = filteredCompanyIds();
  const showCompanyColumn = viewCompanyIds.length > 1;
  const runs = db.payrollRuns
    .filter((r) => viewCompanyIds.includes(r.companyId))
    .slice()
    .sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex);

  const rows = runs
    .map((r) => {
      const fyOfRun = db.financialYears.find((f) => f.id === r.financialYearId);
      const totalNet = r.lines.reduce((s, l) => s + l.netSalary, 0);
      return `
      <tr>
        <td><a href="#/payroll-runs/${r.id}">${fyOfRun ? fyOfRun.code : "-"} - ${monthLabel(r)}</a></td>
        ${showCompanyColumn ? `<td>${escapeHtml((db.companies.find((c) => c.id === r.companyId) || {}).name || "-")}</td>` : ""}
        <td>${r.payrollGroup || "All"}</td>
        <td><span class="badge ${r.status === "PAID" ? "good" : r.status === "DRAFT" ? "neutral" : "good"}">${sentenceCase(r.status)}</span></td>
        <td>${r.lines.length}</td>
        <td>${rupees(totalNet)}</td>
      </tr>`;
    })
    .join("");

  const checkedRunCompanyIds = lastSelectedRunCompanyIds || [getActiveCompanyId()];

  container.innerHTML = `
    ${
      !fy
        ? `<div class="card text-bad">No Financial Year configured.</div>`
        : `<form id="new-run-form" class="card">
      <h3>Create Payroll Run</h3>
      <div class="form-grid">
        <div style="grid-column: 1 / -1;">
          <label>Legal Entity (select one or more)</label>
          <button type="button" id="run-company-btn" style="width:100%;text-align:left;">Select Legal Entity &#9662;</button>
          <div id="run-company-panel" class="card" style="display:none;max-height:220px;overflow-y:auto;padding:10px;margin-top:4px;">
            <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" id="run-company-all" ${checkedRunCompanyIds.length === db.companies.length ? "checked" : ""} /> <strong>All Companies</strong></label>
            <hr style="border-color:var(--line);margin:6px 0;" />
            ${db.companies.map((c) => `<label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" class="run-company-item" value="${c.id}" ${checkedRunCompanyIds.includes(c.id) ? "checked" : ""} /> ${escapeHtml(c.name)}</label>`).join("")}
          </div>
        </div>
        <div><label>Financial Year</label><input value="${fy.code}" disabled /></div>
        <div><label>Month</label>
          <select name="payrollMonthIndex">
            ${FY_MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join("")}
          </select>
        </div>
        <div><label>Payroll Group (optional)</label><input name="payrollGroup" placeholder="Leave blank for all employees" /></div>
      </div>
      <div id="new-run-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16"><button type="submit" class="primary">Create Run</button></div>
    </form>`
    }
    <div class="card">
      <div class="row between">
        <h3 style="margin:0;">Payroll Runs</h3>
        ${
          runs.some((r) => r.status !== "LOCKED" && r.status !== "PAID")
            ? `<button id="btn-run-calc-all">Run Calculation for All</button>`
            : ""
        }
      </div>
      <div id="run-calc-all-message" class="mt-16"></div>
      <table class="mt-16">
        <thead><tr><th>Period</th>${showCompanyColumn ? "<th>Company</th>" : ""}<th>Group</th><th>Status</th><th>Employees</th><th>Total Net Pay</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${showCompanyColumn ? 6 : 5}" class="text-muted">No payroll runs yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  const form = document.getElementById("new-run-form");
  if (form) {
    const companyBtn = document.getElementById("run-company-btn");
    const companyPanel = document.getElementById("run-company-panel");
    const allCb = document.getElementById("run-company-all");
    const itemCbs = () => [...form.querySelectorAll(".run-company-item")];

    function updateCompanyBtnLabel() {
      const checked = itemCbs().filter((cb) => cb.checked);
      if (checked.length === 0) companyBtn.textContent = "Select Legal Entity ▾";
      else if (checked.length === db.companies.length) companyBtn.textContent = "All Companies ▾";
      else if (checked.length === 1) companyBtn.textContent = `${(db.companies.find((c) => c.id === checked[0].value) || {}).name || ""} ▾`;
      else companyBtn.textContent = `${checked.length} companies selected ▾`;
      // Keep the module-level selection in sync with every live edit, so it
      // survives the next renderContent() call intact (see its declaration
      // above for why a local variable here wouldn't).
      lastSelectedRunCompanyIds = checked.map((cb) => cb.value);
    }
    companyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      companyPanel.style.display = companyPanel.style.display === "block" ? "none" : "block";
    });
    allCb.addEventListener("change", () => {
      itemCbs().forEach((cb) => { cb.checked = allCb.checked; });
      updateCompanyBtnLabel();
    });
    itemCbs().forEach((cb) => {
      cb.addEventListener("change", () => {
        allCb.checked = itemCbs().every((c) => c.checked);
        updateCompanyBtnLabel();
      });
    });
    updateCompanyBtnLabel();

    form.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const errorEl = document.getElementById("new-run-error");
      errorEl.textContent = "";
      const fd = new FormData(evt.target);
      const companyIds = itemCbs().filter((cb) => cb.checked).map((cb) => cb.value);
      if (companyIds.length === 0) {
        errorEl.textContent = "Select at least one Legal Entity.";
        return;
      }
      const payrollMonthIndex = Number(fd.get("payrollMonthIndex"));
      const payrollGroup = String(fd.get("payrollGroup") || "").trim() || null;
      // Only when exactly one Legal Entity was picked - this is also what
      // the Legal Entity checkbox panel's own "start checked" state reads
      // (c.id === getActiveCompanyId()) on the next render, so setting it
      // unconditionally here was overwriting a genuine multi-company (or
      // "All Companies") selection down to just the first company the
      // moment the runs were created.
      if (companyIds.length === 1) setActiveCompanyId(companyIds[0]);

      const { calendarYear, calendarMonth } = fyMonthIndexToCalendar(payrollMonthIndex, new Date(fy.startDate).getFullYear());
      const results = [];
      for (const companyId of companyIds) {
        const existing = db.payrollRuns.find((r) => r.companyId === companyId && r.financialYearId === fy.id && r.payrollMonthIndex === payrollMonthIndex && r.payrollGroup === payrollGroup);
        if (existing) {
          results.push({ companyId, run: existing, created: false });
          continue;
        }
        const run = {
          id: newId("run"),
          companyId,
          financialYearId: fy.id,
          payrollMonthIndex,
          calendarYear,
          calendarMonth,
          payrollGroup,
          status: "DRAFT",
          processedAt: null,
          reviewedAt: null,
          approvedAt: null,
          lockedAt: null,
          paidAt: null,
          createdBy: "Payroll Admin",
          createdAt: new Date().toISOString(),
          overrides: {},
          lines: [],
        };
        db.payrollRuns.push(run);
        results.push({ companyId, run, created: true });
      }
      await persist();

      if (results.length === 1) {
        navigate(`payroll-runs/${results[0].run.id}`);
        return;
      }
      const createdCount = results.filter((r) => r.created).length;
      const existingCount = results.length - createdCount;
      alert(`${createdCount} payroll run(s) created${existingCount ? `, ${existingCount} already existed` : ""} for ${monthLabel(results[0].run)}. Open each one from the list below (widen the company filter at the top if some aren't showing).`);
      renderContent();
    });
  }

  const runCalcAllBtn = document.getElementById("btn-run-calc-all");
  if (runCalcAllBtn) {
    runCalcAllBtn.addEventListener("click", async () => {
      const eligible = runs.filter((r) => r.status !== "LOCKED" && r.status !== "PAID");
      runCalcAllBtn.disabled = true;
      runCalcAllBtn.textContent = `Calculating 0 of ${eligible.length}...`;
      let processedTotal = 0;
      const skippedByRun = [];
      let i = 0;
      for (const run of eligible) {
        i += 1;
        runCalcAllBtn.textContent = `Calculating ${i} of ${eligible.length}...`;
        try {
          const result = PayrollEngine.processPayrollRun(db, run.id);
          processedTotal += result.processed;
          if (result.skipped.length) {
            const company = db.companies.find((c) => c.id === run.companyId);
            skippedByRun.push(`${company ? company.name : run.companyId} (${monthLabel(run)}): ${result.skipped.map((s) => s.employeeCode).join(", ")}`);
          }
        } catch (err) {
          const company = db.companies.find((c) => c.id === run.companyId);
          skippedByRun.push(`${company ? company.name : run.companyId} (${monthLabel(run)}): ${err.message}`);
        }
      }
      await persist();
      renderContent();
      const msgEl = document.getElementById("run-calc-all-message");
      if (msgEl) {
        msgEl.textContent = `Calculated ${eligible.length} payroll run(s), ${processedTotal} employee(s) processed in total.${skippedByRun.length ? ` Issues: ${skippedByRun.join(" | ")}` : ""}`;
        msgEl.className = skippedByRun.length ? "text-bad mt-16" : "text-good mt-16";
      }
    });
  }
}

function renderPayrollRunDetail(container, runId) {
  function render() {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) {
      container.innerHTML = `<div class="card">Payroll run not found. <a href="#/payroll-runs">Back to Payroll Runs</a></div>`;
      return;
    }
    const fy = db.financialYears.find((f) => f.id === run.financialYearId);
    const company = db.companies.find((c) => c.id === run.companyId);
    const nextStatus = PayrollEngine.PAYROLL_STATUS_ORDER[PayrollEngine.PAYROLL_STATUS_ORDER.indexOf(run.status) + 1];
    const totalNet = run.lines.reduce((s, l) => s + l.netSalary, 0);
    const totalGross = run.lines.reduce((s, l) => s + l.grossSalary, 0);
    const totalTds = run.lines.reduce((s, l) => s + l.tdsMonthly, 0);
    // Only show a deduction-component column when at least one line in this
    // run actually has a nonzero amount for it - most companies don't use
    // ESI/LWF at all, so showing 2-3 columns instead of a fixed 5 is the
    // common case, keeping the table scannable without losing anything (the
    // full per-line breakdown is always in Details regardless).
    const DEDUCTION_COLUMNS = [
      ["Employee PF", (l) => l.deductions["EMPLOYEE_PF"] ?? 0],
      ["Employee ESI", (l) => l.deductions["EMPLOYEE_ESI"] ?? 0],
      ["Professional Tax", (l) => l.deductions["PROFESSIONAL_TAX"] ?? 0],
      ["LWF", (l) => l.deductions["LWF"] ?? 0],
      ["Other Deductions", (l) => sumCodesR(l.deductions, OTHER_DEDUCTION_CODES)],
    ].filter(([, get]) => run.lines.some((l) => get(l) !== 0));

    container.innerHTML = `
      <a href="#/payroll-runs"><button class="no-print">&larr; Back to Payroll Runs</button></a>
      <div class="row between mt-16">
        <div>
          <h2 style="margin-bottom:2px;">${company ? escapeHtml(company.name) : ""}</h2>
          <div class="text-muted">${fy ? fy.code : ""} - ${monthLabel(run)} · ${run.payrollGroup || "All employees"} · <span class="badge good">${sentenceCase(run.status)}</span></div>
        </div>
        <div class="row gap-8">
          <button id="btn-calculate" ${run.status === "LOCKED" || run.status === "PAID" ? "disabled" : ""}>${run.lines.length ? "Recalculate" : "Run Calculation"}</button>
          ${run.lines.length ? `<a href="#/payroll-runs/${run.id}/register"><button>Salary Register</button></a>` : ""}
          ${run.lines.length ? `<a href="#/payroll-runs/${run.id}/bank-file"><button>Bank Payment File</button></a>` : ""}
          ${run.status === "REVIEWED" || run.status === "APPROVED" ? `<button id="btn-revert" title="Found an error after marking this? Send it back one step to fix and re-review.">&larr; Revert to ${sentenceCase(PayrollEngine.PAYROLL_STATUS_ORDER[PayrollEngine.PAYROLL_STATUS_ORDER.indexOf(run.status) - 1])}</button>` : ""}
          ${nextStatus && run.lines.length ? `<button class="primary" id="btn-advance">Mark as ${nextStatus}</button>` : ""}
        </div>
      </div>
      <div class="card-grid mt-16">
        <div class="card"><div class="stat-label">Employees</div><div class="stat-value">${run.lines.length}</div></div>
        <div class="card"><div class="stat-label">Total Gross</div><div class="stat-value">${rupees(totalGross)}</div></div>
        <div class="card"><div class="stat-label">Total TDS</div><div class="stat-value">${rupees(totalTds)}</div></div>
        <div class="card"><div class="stat-label">Total Net Pay</div><div class="stat-value">${rupees(totalNet)}</div></div>
      </div>
      <div id="calc-message" class="text-muted mt-16"></div>
      <div class="card mt-16">
        <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Employee</th><th>Gross</th>${DEDUCTION_COLUMNS.map(([h]) => `<th>${h}</th>`).join("")}<th>TDS</th><th>Adjustments</th><th>Net Pay</th><th>Regime</th><th></th></tr></thead>
          <tbody>
            ${
              run.lines
                .map((l) => {
                  const emp = db.employees.find((e) => e.id === l.employeeId);
                  const adjTotal = l.adjustments.reduce((s, a) => s + a.amount, 0);
                  return `
                  <tr>
                    <td>${emp ? `${escapeHtml(emp.employeeCode)} - ${escapeHtml(emp.fullName)}` : l.employeeId}</td>
                    <td>${rupees(l.grossSalary)}</td>
                    ${DEDUCTION_COLUMNS.map(([, get]) => `<td>${rupees(get(l))}</td>`).join("")}
                    <td>${rupees(l.tdsMonthly)}</td>
                    <td>${adjTotal ? rupees(adjTotal) : "-"}</td>
                    <td><strong>${rupees(l.netSalary)}</strong></td>
                    <td>${sentenceCase(l.regimeUsed)}${emp && emp.taxRegime !== l.regimeUsed ? ` <span class="text-muted" style="font-size:11px;" title="This line was already computed under ${sentenceCase(l.regimeUsed)} - the employee has since switched regime. Recalculate this run to apply ${sentenceCase(emp.taxRegime)} here.">(now ${sentenceCase(emp.taxRegime)})</span>` : ""}</td>
                    <td class="row gap-8">
                      <a href="#/payroll-runs/${run.id}/line/${l.id}"><button>Details</button></a>
                      <a href="#/payroll-runs/${run.id}/slip/${l.id}"><button>Slip</button></a>
                    </td>
                  </tr>
                `;
                })
                .join("") || `<tr><td colspan="${7 + DEDUCTION_COLUMNS.length}" class="text-muted">Not calculated yet. Click "Run Calculation" above.</td></tr>`
            }
          </tbody>
        </table>
        </div>
      </div>
    `;

    document.getElementById("btn-calculate").addEventListener("click", async () => {
      try {
        const result = PayrollEngine.processPayrollRun(db, run.id);
        await persist();
        render();
        const newMsgEl = document.getElementById("calc-message");
        if (result.skipped.length) {
          newMsgEl.textContent = `Processed ${result.processed}. Skipped: ${result.skipped.map((s) => `${s.employeeCode} (${s.reason})`).join("; ")}`;
          newMsgEl.className = "text-bad mt-16";
        } else {
          newMsgEl.textContent = `Processed ${result.processed} employee(s).`;
          newMsgEl.className = "text-good mt-16";
        }
      } catch (err) {
        alert(err.message);
      }
    });

    const advanceBtn = document.getElementById("btn-advance");
    if (advanceBtn) {
      advanceBtn.addEventListener("click", async () => {
        try {
          PayrollEngine.advancePayrollStatus(db, run.id, nextStatus);
          logAudit("PayrollRun", run.id, "STATUS_CHANGE", `${monthLabel(run)} marked as ${nextStatus}`);
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    const revertBtn = document.getElementById("btn-revert");
    if (revertBtn) {
      revertBtn.addEventListener("click", async () => {
        const fromStatus = run.status;
        if (!confirm(`Revert ${monthLabel(run)} from ${sentenceCase(fromStatus)} back a step so you can make changes and re-review? You'll need to mark it as ${sentenceCase(fromStatus)} again when ready.`)) return;
        try {
          PayrollEngine.revertPayrollStatus(db, run.id);
          logAudit("PayrollRun", run.id, "STATUS_CHANGE", `${monthLabel(run)} reverted from ${fromStatus} to ${run.status}`);
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    }

  }

  render();
}

// One-time BONUS/INCENTIVE/OVERTIME/ARREARS/OTHER_ALLOWANCE have no
// structure component to begin with, so they only show up as an editable
// field once they already have a non-zero value (via Object.keys(line.
// earnings)) unless always offered - this keeps them available up front
// without needing a value already set. Declared at top level since it's
// used by both renderPayrollLineDetailPage and renderLineDetail below.
const ALWAYS_OFFERED_EARNING_CODES = ["BONUS", "INCENTIVE", "OVERTIME", "ARREARS", "OTHER_ALLOWANCE"];

/**
 * Full-page view of one employee's line within a payroll run - manual
 * overrides, earnings/deductions/employer-contributions breakdown, tax
 * trace, and adjustments. Its own route (not an inline expand within the
 * run's table) so opening it doesn't push every other row around, same
 * as the Slip page right next to it.
 */
function renderPayrollLineDetailPage(container, runId, lineId) {
  function render() {
    const run = db.payrollRuns.find((r) => r.id === runId);
    const line = run && run.lines.find((l) => l.id === lineId);
    if (!run || !line) {
      container.innerHTML = `<div class="card">Payroll line not found. <a href="#/payroll-runs/${runId}">Back to Payroll Run</a></div>`;
      return;
    }
    const emp = db.employees.find((e) => e.id === line.employeeId);
    const company = db.companies.find((c) => c.id === run.companyId);
    container.innerHTML = `
      <a href="#/payroll-runs/${run.id}"><button class="no-print">&larr; Back to Payroll Run</button></a>
      <div class="row between mt-16">
        <div>
          <h2 style="margin-bottom:2px;">${emp ? escapeHtml(emp.fullName) : line.employeeId}</h2>
          <div class="text-muted">${company ? escapeHtml(company.name) + " · " : ""}${monthLabel(run)}${emp ? ` · ${escapeHtml(emp.employeeCode)}` : ""}</div>
        </div>
        <a href="#/payroll-runs/${run.id}/slip/${line.id}"><button>View Slip</button></a>
      </div>
      <div class="mt-16">${renderLineDetail(line, emp, run)}</div>
    `;

    container.querySelectorAll(".switch-regime-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const employee = db.employees.find((e) => e.id === btn.dataset.emp);
        const newRegime = btn.dataset.switchTo;
        if (!employee) return;
        if (!confirm(`Switch ${employee.fullName} from ${sentenceCase(employee.taxRegime).toLowerCase()} to ${sentenceCase(newRegime).toLowerCase()} regime? This takes effect from the next payroll run onward - this run's already-calculated line is unaffected until you recalculate.`)) return;
        try {
          const fromRegime = employee.taxRegime;
          PayrollEngine.applyRegimeSwitch(db, employee.id, newRegime);
          logAudit("Employee", employee.id, "REGIME_SWITCH", `${employee.fullName} (${employee.employeeCode}) switched from ${fromRegime} to ${newRegime} regime`);
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    container.querySelectorAll(".adjustment-form").forEach((form) => {
      form.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        const fd = new FormData(evt.target);
        try {
          const amount = num(fd.get("amount"));
          const reason = String(fd.get("reason") || "");
          PayrollEngine.addAdjustment(db, form.dataset.lineId, { amount, reason, enteredBy: String(fd.get("enteredBy") || "") });
          logAudit("PayrollAdjustment", form.dataset.lineId, "CREATE", `${reason}: ${rupees(amount)}`);
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    container.querySelectorAll(".quick-deduction-form").forEach((form) => {
      form.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        const fd = new FormData(evt.target);
        try {
          const kind = String(fd.get("kind") || "Other Deduction");
          const note = String(fd.get("note") || "").trim();
          const reason = note ? `${kind}: ${note}` : kind;
          const amount = -Math.abs(num(fd.get("amount")));
          PayrollEngine.addAdjustment(db, form.dataset.lineId, { amount, reason, enteredBy: String(fd.get("enteredBy") || "") });
          logAudit("PayrollAdjustment", form.dataset.lineId, "CREATE", `${reason}: ${rupees(amount)}`);
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    container.querySelectorAll(".save-override").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const employeeId = btn.getAttribute("data-employee-id");
        const form = container.querySelector(`.override-form[data-employee-id="${employeeId}"]`);
        const fd = new FormData(form);
        const lopDays = num(fd.get("lopDays"));

        // Every earning/deduction/employer-contribution field currently
        // shown in the form (one per component on this month's line) is
        // gathered fresh - there's no need to separately preserve anything
        // not in the form, since the form always covers every code
        // currently on the line (including e.g. GRATUITY_TAXABLE/
        // LEAVE_ENCASHMENT_TAXABLE posted by F&F Settlement, which show up
        // here like any other earning once they have a value).
        const variablePay = {};
        form.querySelectorAll(".earn-adj-field").forEach((inp) => {
          const amt = num(inp.value);
          if (amt) variablePay[inp.name] = amt;
        });
        const deductionAdjustments = {};
        form.querySelectorAll(".ded-adj-field").forEach((inp) => {
          const amt = num(inp.value);
          if (amt) deductionAdjustments[inp.name] = amt;
        });
        const employerContribAdjustments = {};
        form.querySelectorAll(".emp-adj-field").forEach((inp) => {
          const amt = num(inp.value);
          if (amt) employerContribAdjustments[inp.name] = amt;
        });

        const tdsOverrideRaw = form.querySelector(".tds-override-amount").value.trim();
        const tdsOverrideReason = form.querySelector(".tds-override-reason").value.trim();
        if (tdsOverrideRaw && !tdsOverrideReason) {
          alert("Enter a reason for overriding TDS, or leave the Override TDS amount blank to use the computed figure.");
          return;
        }

        if (!run.overrides) run.overrides = {};
        const hasAnyOverride = lopDays || Object.keys(variablePay).length || Object.keys(deductionAdjustments).length || Object.keys(employerContribAdjustments).length || tdsOverrideRaw;
        if (hasAnyOverride) {
          run.overrides[employeeId] = {
            lopDays,
            variablePay,
            deductionAdjustments,
            employerContribAdjustments,
            tdsOverride: tdsOverrideRaw ? num(tdsOverrideRaw) : undefined,
            tdsOverrideReason: tdsOverrideRaw ? tdsOverrideReason : undefined,
          };
        } else {
          delete run.overrides[employeeId];
        }
        try {
          const wasOverridden = run.overrides[employeeId] && run.overrides[employeeId].tdsOverride !== undefined;
          const recalculated = PayrollEngine.recalculateLine(db, run.id, employeeId);
          if (wasOverridden) {
            logAudit("PayrollTdsOverride", recalculated.id, "OVERRIDE", `TDS for ${monthLabel(run)} manually set to ${rupees(recalculated.tdsMonthly)} (computed was ${rupees(recalculated.computedTdsMonthly)}): ${tdsOverrideReason}`);
          }
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  render();
}

function esiContinuityBadge(code, line, emp) {
  if (code !== "EMPLOYEE_ESI" || !line.metrics) return "";
  if (line.metrics.esiCoverageActiveThisMonth && !emp.esiApplicable) {
    return ` <span class="badge neutral" title="ESI Applicable is off for this employee, but contribution-period continuity keeps ESI active through this period's end (1-Apr to 30-Sep, or 1-Oct to 31-Mar) since it was already active earlier in it.">Continuing</span>`;
  }
  if (line.metrics.esiCeilingExceededThisMonth) {
    return ` <span class="badge neutral" title="Gross salary this month is above the ESI wage ceiling, but coverage continues through this contribution period's end regardless.">Above ceiling</span>`;
  }
  return "";
}

function renderLineDetail(line, emp, run) {
    const snap = line.taxCalcSnapshot[line.regimeUsed.toLowerCase()];
    const override = (run.overrides && run.overrides[line.employeeId]) || {};
    const vp = override.variablePay || {};
    const da = override.deductionAdjustments || {};
    const ea = override.employerContribAdjustments || {};
    const canEdit = run.status !== "LOCKED" && run.status !== "PAID";
    const dis = canEdit ? "" : "disabled";
    // Every field a reader can see on this month's payslip (earnings,
    // deductions, employer contributions) is editable here as a delta on
    // top of whatever the salary structure/auto-calc produced - scoped to
    // this one run only, never written back to the structure, never
    // carried into future months. TDS is the one exception: it isn't built
    // from independent line items, so it gets a direct absolute override
    // instead of a delta (see the field below).
    const earningCodes = [...new Set([...Object.keys(line.earnings), ...ALWAYS_OFFERED_EARNING_CODES])];
    const deductionCodes = Object.keys(line.deductions);
    const employerCodes = Object.keys(line.employerContributions);
    return `
      <div class="card" style="margin:8px 0;">
        <div class="row between">
          <div>
            <h3 style="margin-bottom:2px;">${emp ? escapeHtml(emp.fullName) : ""}</h3>
            <div class="text-muted">Days worked ${line.daysWorked}/${line.daysInMonth}${line.lopDays ? ` (LOP: ${line.lopDays})` : ""} · Regime used: ${sentenceCase(line.regimeUsed)}</div>
          </div>
          ${
            emp
              ? `<div class="row gap-8">
            <button data-emp="${emp.id}" data-switch-to="${emp.taxRegime === "OLD" ? "NEW" : "OLD"}" class="switch-regime-btn" title="Switches the employee's regime for future payroll runs - already-calculated lines (including this one) are unaffected until recalculated.">Switch to ${sentenceCase(emp.taxRegime === "OLD" ? "NEW" : "OLD")}</button>
            <a href="#/employees/${emp.id}/regime/from-run/${run.id}"><button>Regime Comparison</button></a>
          </div>`
              : ""
          }
        </div>
        <div class="card" style="background:var(--ink); margin-top:12px;">
          <h3>Manual Changes (this month only)</h3>
          <p class="text-muted" style="font-size:12px;">Every amount below is added to (or, entered negative, subtracted from) whatever the salary structure/auto-calculation produced for THIS run only - the salary structure itself is never changed, and nothing here carries over to future months. To change Basic by, say, +Rs 1 for just this month, enter 1 in the Basic field below, not 10001.</p>
          <form class="override-form" data-employee-id="${line.employeeId}">
            <div class="form-grid">
              <div><label>LOP Days</label><input type="number" min="0" name="lopDays" value="${override.lopDays || 0}" ${dis} /></div>
            </div>
            <h4 class="mt-16">Earnings adjustment</h4>
            <div class="form-grid">
              ${earningCodes.map((code) => `<div><label>${componentLabel(code)}</label><input type="number" class="earn-adj-field" name="${code}" value="${vp[code] || 0}" ${dis} /></div>`).join("")}
            </div>
            ${
              deductionCodes.length
                ? `<h4 class="mt-16">Deductions adjustment</h4>
            <div class="form-grid">
              ${deductionCodes.map((code) => `<div><label>${componentLabel(code)}</label><input type="number" class="ded-adj-field" name="${code}" value="${da[code] || 0}" ${dis} /></div>`).join("")}
            </div>`
                : ""
            }
            ${
              employerCodes.length
                ? `<h4 class="mt-16">Employer contribution adjustment</h4>
            <div class="form-grid">
              ${employerCodes.map((code) => `<div><label>${componentLabel(code)}</label><input type="number" class="emp-adj-field" name="${code}" value="${ea[code] || 0}" ${dis} /></div>`).join("")}
            </div>`
                : ""
            }
            <h4 class="mt-16">TDS override</h4>
            <p class="text-muted" style="font-size:12px;">Replaces the computed monthly TDS outright (not a delta) for this run only - the tax calculation trace below still shows what the engine itself computed. Leave the amount blank to use the computed figure.</p>
            <div class="form-grid">
              <div><label>Override TDS to (Rs)</label><input type="number" min="0" class="tds-override-amount" name="tdsOverrideAmount" value="${line.tdsOverridden ? line.tdsMonthly : ""}" placeholder="${rupees(line.computedTdsMonthly ?? line.tdsMonthly)}" ${dis} /></div>
              <div><label>Reason (required if overriding)</label><input type="text" class="tds-override-reason" name="tdsOverrideReason" value="${escapeHtml(line.tdsOverrideReason || "")}" ${dis} /></div>
            </div>
          </form>
          ${canEdit ? `<div class="row gap-8 mt-16"><button class="primary save-override" data-employee-id="${line.employeeId}">Save &amp; Recalculate</button></div>` : `<p class="text-muted mt-16">This run is ${run.status.toLowerCase()} - manual changes can no longer be made here. Use a Manual Adjustment instead.</p>`}
        </div>
        <div class="card-grid mt-16">
          <div>
            <h3>Earnings</h3>
            <table>${Object.entries(line.earnings).map(([k, v]) => `<tr><td>${componentLabel(k)}</td><td>${rupees(v)}</td></tr>`).join("")}</table>
          </div>
          <div>
            <h3>Deductions</h3>
            <table>${Object.entries(line.deductions).map(([k, v]) => `<tr><td>${componentLabel(k)}${esiContinuityBadge(k, line, emp)}</td><td>${rupees(v)}</td></tr>`).join("")}<tr><td>TDS${line.tdsOverridden ? ` <span class="badge bad" title="Manually overridden${line.tdsOverrideReason ? `: ${escapeHtml(line.tdsOverrideReason)}` : ""}. Computed figure was ${rupees(line.computedTdsMonthly)}.">Overridden</span>` : line.tdsMethodUsed === "PROPORTIONAL" ? ` <span class="badge neutral" title="Computed by the Proportional method (Setup > Tax Rules) - triggered by a Bonus, Arrears or this employee's joining month - instead of the Standard even monthly spread.">Proportional</span>` : ""}</td><td>${rupees(line.tdsMonthly)}</td></tr></table>
          </div>
          <div>
            <h3>Employer Contributions</h3>
            <table>${Object.entries(line.employerContributions).map(([k, v]) => `<tr><td>${componentLabel(k)}</td><td>${rupees(v)}</td></tr>`).join("")}</table>
          </div>
        </div>
        ${
          snap
            ? `<details class="mt-16"><summary>Tax calculation trace (${sentenceCase(line.regimeUsed).toLowerCase()} regime, annualized)</summary>
              <table class="mt-16">${snap.steps.map((s) => `<tr><td>${s.label}${s.note ? ` <span class="text-muted">(${s.note})</span>` : ""}</td><td>${rupees(s.amount)}</td></tr>`).join("")}</table>
            </details>`
            : ""
        }
        <h3 class="mt-16">Adjustments</h3>
        <table>
          ${line.adjustments.map((a) => `<tr><td>${formatDateDisplay(a.createdAt)}</td><td>${escapeHtml(a.reason)}</td><td>${escapeHtml(a.enteredBy)}</td><td>${rupees(a.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">No adjustments.</td></tr>`}
        </table>
        <p class="text-muted mt-16" style="font-size:12px;">Reduces net pay only - not taxed, not added to gross salary (for loan EMI recovery, interest recovery, or any other post-tax one-time deduction). Enter a positive amount; it's deducted automatically.</p>
        <form class="quick-deduction-form row gap-8 mt-16" data-line-id="${line.id}">
          <select name="kind" style="max-width:160px;">
            <option value="Loan Recovery">Loan Recovery</option>
            <option value="Interest Recovery">Interest Recovery</option>
            <option value="Other Deduction">Other Deduction</option>
          </select>
          <input name="note" placeholder="Note (optional)" style="flex:1;" />
          <input type="number" name="amount" min="0" step="0.01" placeholder="Amount" required style="max-width:140px;" />
          <input name="enteredBy" placeholder="Entered by" required style="max-width:140px;" />
          <button type="submit" class="primary">Add Deduction</button>
        </form>
        <h4 class="mt-16">Add a custom adjustment instead</h4>
        <p class="text-muted" style="font-size:12px;">For anything else - a positive amount adds to net pay, negative subtracts.</p>
        <form class="adjustment-form row gap-8 mt-16" data-line-id="${line.id}">
          <input type="number" name="amount" placeholder="Amount (+/-)" required style="max-width:140px;" />
          <input name="reason" placeholder="Reason" required style="flex:1;" />
          <input name="enteredBy" placeholder="Entered by" required style="max-width:140px;" />
          <button type="submit">Add Adjustment</button>
        </form>
      </div>
    `;
}

// --- Salary Register ---------------------------------------------------
function renderSalaryRegister(container, runId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  if (!run) {
    container.innerHTML = `<div class="card">Payroll run not found.</div>`;
    return;
  }
  const company = db.companies.find((c) => c.id === run.companyId);
  const rows = getSalaryRegisterRows(db, runId);
  container.innerHTML = `
    <div class="row between no-print">
      <a href="#/payroll-runs/${runId}"><button>&larr; Back to Payroll Run</button></a>
      <div class="row gap-8">
        <button id="btn-export-csv">Export CSV</button>
        <button id="btn-print">Print</button>
      </div>
    </div>
    <div class="card mt-16">
      <h2>Salary Register - ${company ? escapeHtml(company.name) + " - " : ""}${monthLabel(run)}</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr>${SALARY_REGISTER_COLUMNS.map(([h]) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${SALARY_REGISTER_COLUMNS.map(([, f]) => `<td>${typeof r[f] === "number" ? rupees(r[f]) : escapeHtml(r[f] || "")}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    downloadCsv(`salary-register-${runId}.csv`, SALARY_REGISTER_COLUMNS.map(([h]) => h), rows.map((r) => SALARY_REGISTER_COLUMNS.map(([, f]) => r[f])));
  });
  document.getElementById("btn-print").addEventListener("click", () => window.print());
}

// --- Bank Payment File ---------------------------------------------------
// Builds the rows (as an array-of-arrays, headers first) for a bank
// template's own .xlsx: every column is a plain text cell except the one
// marked format:"amount", which stays a real number so Excel doesn't
// mangle account numbers/IFSC/value-dates by reinterpreting them, while
// Amount still sums correctly for whoever uploads the file to the bank. A
// template marked includeControlTotalRow gets one trailing row, blank
// except Amount = sum of every row above it - that's the bank's own
// control-total convention (confirmed against a real HDFC sample), not
// something this app invented.
function buildBankFileWorkbookRows(template, rows) {
  const headers = template.columns.map((c) => c.header);
  const amountColIndex = template.columns.findIndex((c) => c.format === "amount");
  const dataRows = rows.map((r) => template.columns.map((c) => (c.format === "amount" ? Number(r[c.field]) || 0 : String(r[c.field] ?? ""))));
  if (template.includeControlTotalRow && amountColIndex >= 0) {
    const total = rows.reduce((s, r) => s + (Number(r[template.columns[amountColIndex].field]) || 0), 0);
    dataRows.push(template.columns.map((c, i) => (i === amountColIndex ? total : null)));
  }
  return [headers, ...dataRows];
}

function exportBankFileXlsx(template, rows, filename) {
  const aoa = buildBankFileWorkbookRows(template, rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = template.columns.map((c) => ({ wch: Math.max(14, c.header.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Salary Payment");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadWorkbook(filename, buf);
}

function renderBankFile(container, runId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  if (!run) {
    container.innerHTML = `<div class="card">Payroll run not found.</div>`;
    return;
  }
  const company = db.companies.find((c) => c.id === run.companyId);
  const templates = db.bankFileTemplates.filter((t) => t.isActive);
  // Defaults to the last calendar day of the payroll month - a common
  // salary-disbursal convention - but it's the actual date money should
  // move, so it's always editable before export.
  let valueDate = `${run.calendarYear}-${String(run.calendarMonth).padStart(2, "0")}-${String(daysInCalendarMonth(run.calendarYear, run.calendarMonth)).padStart(2, "0")}`;

  function render(templateCode) {
    const template = templates.find((t) => t.code === templateCode) || templates[0];
    const columns = template.columns;
    const needsValueDate = columns.some((c) => c.field === "valueDate");
    const { rows, issues: employeeIssues, monthLabel: ml } = buildBankFileData(db, runId, { valueDate });
    const issues = company ? [...companyBankFileIssues(company, template), ...employeeIssues] : employeeIssues;
    container.innerHTML = `
      <div class="row between no-print">
        <a href="#/payroll-runs/${runId}"><button>&larr; Back to Payroll Run</button></a>
        <div class="row gap-8" style="align-items:center;">
          <select id="template-select">${templates.map((t) => `<option value="${t.code}" ${t.code === template.code ? "selected" : ""}>${t.bankName}</option>`).join("")}</select>
          ${needsValueDate ? `<label style="margin-bottom:0;">Value Date <input type="date" id="value-date-input" value="${valueDate}" /></label>` : ""}
          <button id="btn-export">Export ${template.fileType === "xlsx" ? "Excel (.xlsx)" : "CSV"}</button>
        </div>
      </div>
      ${
        issues.length
          ? `<div class="card text-bad mt-16"><h3>Validation Issues (${issues.length})</h3><ul>${issues.map((i) => `<li>${escapeHtml(i.employeeCode)} - ${escapeHtml(i.employeeName)}: ${escapeHtml(i.issue)}</li>`).join("")}</ul></div>`
          : ""
      }
      <div class="card mt-16">
        <h2>Bank Payment File - ${company ? escapeHtml(company.name) + " - " : ""}${ml} (${template.bankName})</h2>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>${columns.map((c) => `<th>${c.header}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${c.format === "amount" ? rupees(r[c.field]) : escapeHtml(r[c.field] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById("template-select").addEventListener("change", (e) => render(e.target.value));
    const valueDateInput = document.getElementById("value-date-input");
    if (valueDateInput) {
      valueDateInput.addEventListener("change", (e) => {
        valueDate = e.target.value;
        render(template.code);
      });
    }
    document.getElementById("btn-export").addEventListener("click", () => {
      if (template.fileType === "xlsx") {
        exportBankFileXlsx(template, rows, `bank-file-${runId}-${template.code}.xlsx`);
      } else {
        downloadCsv(`bank-file-${runId}-${template.code}.csv`, columns.map((c) => c.header), rows.map((r) => columns.map((c) => r[c.field])));
      }
    });
  }
  render(templates[0] && templates[0].code);
}

// --- Salary Slip ---------------------------------------------------------
const SLIP_COMPONENT_LABELS = {
  BASIC: "Basic Salary", DA: "Dearness Allowance", HRA: "House Rent Allowance", SPECIAL_ALLOWANCE: "Special Allowance",
  CONVEYANCE: "Conveyance Allowance", TRANSPORT_ALLOWANCE: "Transport Allowance", MEDICAL_ALLOWANCE: "Medical Allowance",
  LTA: "LTA / LTC", BONUS: "Bonus", INCENTIVE: "Incentive", COMMISSION: "Commission", OVERTIME: "Overtime", ARREARS: "Arrears",
  PERFORMANCE_PAY: "Performance Pay", OTHER_ALLOWANCE: "Other Allowances", EMPLOYER_PF: "Employer PF", EMPLOYER_NPS: "Employer NPS",
  EMPLOYER_SUPERANNUATION: "Employer Superannuation", GRATUITY: "Gratuity", OTHER_EMPLOYER_BENEFIT: "Other Employer Benefits",
  GRATUITY_TAXABLE: "Gratuity (Taxable Excess)", LEAVE_ENCASHMENT_TAXABLE: "Leave Encashment (Taxable Excess)",
  EMPLOYEE_PF: "Employee PF", EMPLOYEE_ESI: "Employee ESI", PROFESSIONAL_TAX: "Professional Tax", LWF: "Labour Welfare Fund",
  SALARY_ADVANCE: "Salary Advance Recovery", LOAN_RECOVERY: "Loan Recovery", OTHER_DEDUCTION: "Other Deductions",
};

function maskAccount(acc) {
  if (!acc) return "-";
  if (acc.length <= 4) return acc;
  return "X".repeat(acc.length - 4) + acc.slice(-4);
}

// Builds the printable payslip card itself (header through footer note) for
// one run+line, with no page chrome (back/print buttons) around it - shared
// by the single-slip route below and the Salary Slips browser's bulk
// print/download view, which stacks several of these with page breaks.
function buildSlipCardHtml(run, line) {
  const employee = db.employees.find((e) => e.id === line.employeeId);
  const company = db.companies.find((c) => c.id === run.companyId) || db.companies[0] || { name: "", address: "", pan: "", tan: "", logoDataUrl: null };
  const fy = db.financialYears.find((f) => f.id === run.financialYearId);
  const priorLines = db.payrollRuns
    .filter((r) => r.financialYearId === run.financialYearId && r.payrollMonthIndex <= run.payrollMonthIndex)
    .flatMap((r) => r.lines)
    .filter((l) => l.employeeId === line.employeeId);
  const ytdGross = priorLines.reduce((s, l) => s + l.grossSalary, 0);
  const ytdTds = priorLines.reduce((s, l) => s + l.tdsMonthly, 0);
  const ytdNet = priorLines.reduce((s, l) => s + l.netSalary, 0);
  const ytdDeductionCodes = [...new Set(priorLines.flatMap((l) => Object.keys(l.deductions)))];
  const ytdDeductionsByCode = ytdDeductionCodes
    .map((code) => [code, priorLines.reduce((s, l) => s + (l.deductions[code] || 0), 0)])
    .filter(([, amt]) => amt !== 0);
  // A manual adjustment can go either way - a loan recovery reduces net pay
  // like any deduction, but an F&F settlement's exempt Gratuity/Leave
  // Encashment portion INCREASES it (and is often large - routinely bigger
  // than the month's actual statutory deductions). Folding both signs into
  // one "Total Deductions" figure forced it negative whenever the positive
  // ones won, which read as a double negative on the payslip. Splitting by
  // sign keeps Total Deductions a plain, always-sensible positive number
  // (statutory deductions + net-pay-reducing adjustments), with net-pay-
  // increasing adjustments shown as their own "Other Additions" block
  // instead - Gross + Other Additions - Total Deductions still identically
  // equals Net Salary Payable (line.netSalary), just split differently.
  const ytdPositiveAdjustmentsTotal = priorLines.reduce((s, l) => s + l.adjustments.filter((a) => a.amount > 0).reduce((s2, a) => s2 + a.amount, 0), 0);
  const ytdNegativeAdjustmentsMagnitude = priorLines.reduce((s, l) => s - l.adjustments.filter((a) => a.amount < 0).reduce((s2, a) => s2 + a.amount, 0), 0);
  const ytdDeductionsTotal = ytdDeductionsByCode.reduce((s, [, amt]) => s + amt, 0) + ytdTds + ytdNegativeAdjustmentsMagnitude;
  const positiveAdjustments = line.adjustments.filter((a) => a.amount > 0);
  const negativeAdjustments = line.adjustments.filter((a) => a.amount < 0);
  const additionsTotal = positiveAdjustments.reduce((s, a) => s + a.amount, 0);
  const negativeAdjustmentsMagnitude = -negativeAdjustments.reduce((s, a) => s + a.amount, 0);
  const annualTaxLiability = line.taxCalcSnapshot[line.regimeUsed.toLowerCase()].totalTaxLiability;

  const earningRows = Object.entries(line.earnings).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${componentLabel(code)}</td><td>${rupees(amt)}</td></tr>`).join("");
  const employerRows = Object.entries(line.employerContributions).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${componentLabel(code)}</td><td>${rupees(amt)}</td></tr>`).join("");
  const deductionRows = Object.entries(line.deductions).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${componentLabel(code)}</td><td>${rupees(amt)}</td></tr>`).join("");
  const additionRows = positiveAdjustments.map((a) => `<tr><td>${escapeHtml(a.reason)}</td><td>${rupees(a.amount)}</td></tr>`).join("");
  const deductionAdjustmentRows = negativeAdjustments.map((a) => `<tr><td>${escapeHtml(a.reason)}</td><td>${rupees(-a.amount)}</td></tr>`).join("");

  return `
    <div class="card mt-16">
      <div class="row between" style="border-bottom:2px solid var(--line); padding-bottom:8px;">
        <div class="row gap-8" style="align-items:flex-start;">
          ${company.logoDataUrl ? `<img src="${company.logoDataUrl}" alt="${escapeHtml(company.name)} logo" style="max-height:56px; max-width:160px; object-fit:contain;" />` : ""}
          <div>
            <h2 style="margin-bottom:2px;">${escapeHtml(company.name)}</h2>
            <div class="text-muted">${escapeHtml(company.address || "")}</div>
            <div class="text-muted">PAN: ${company.pan || "-"}  TAN: ${company.tan || "-"}</div>
          </div>
        </div>
        <div class="text-muted" style="text-align:right;">
          <div>Payslip for ${monthLabel(run)}</div>
          <div>FY ${fy.code}</div>
        </div>
      </div>
      <h2 style="text-align:center;">Payslip - ${monthLabel(run)}</h2>
      <div class="card-grid">
        <table>
          <tr><td class="text-muted">Employee Code</td><td>${escapeHtml(employee.employeeCode)}</td></tr>
          <tr><td class="text-muted">Employee Name</td><td>${escapeHtml(employee.fullName)}</td></tr>
          <tr><td class="text-muted">Designation</td><td>${escapeHtml(employee.designation || "-")}</td></tr>
          <tr><td class="text-muted">Department</td><td>${escapeHtml(employee.department || "-")}</td></tr>
          <tr><td class="text-muted">PAN</td><td>${employee.pan || "-"}</td></tr>
          <tr><td class="text-muted">UAN</td><td>${employee.uan || "-"}</td></tr>
        </table>
        <table>
          <tr><td class="text-muted">Bank Name</td><td>${employee.bankName || "-"}</td></tr>
          <tr><td class="text-muted">Account No.</td><td>${maskAccount(employee.bankAccountNo)}</td></tr>
          <tr><td class="text-muted">Days in Month</td><td>${line.daysInMonth}</td></tr>
          <tr><td class="text-muted">Days Worked</td><td>${line.daysWorked}</td></tr>
          <tr><td class="text-muted">LOP Days</td><td>${line.lopDays}</td></tr>
          <tr><td class="text-muted">Tax Regime</td><td>${sentenceCase(line.regimeUsed)}</td></tr>
        </table>
      </div>
      <div class="card-grid mt-16">
        <div>
          <h3>Earnings</h3>
          <table>${earningRows}<tr><td><strong>Gross Salary</strong></td><td><strong>${rupees(line.grossSalary)}</strong></td></tr></table>
        </div>
        <div>
          <h3>Deductions</h3>
          <table>
            ${deductionRows}
            <tr><td>TDS</td><td>${rupees(line.tdsMonthly)}</td></tr>
            ${deductionAdjustmentRows}
            <tr><td><strong>Total Deductions</strong></td><td><strong>${rupees(line.totalDeductions + negativeAdjustmentsMagnitude)}</strong></td></tr>
          </table>
        </div>
      </div>
      ${
        additionRows
          ? `<div class="card-grid mt-16">
              <div>
                <h3>Other Additions (non-taxable)</h3>
                <table>${additionRows}<tr><td><strong>Total Additions</strong></td><td><strong>${rupees(additionsTotal)}</strong></td></tr></table>
              </div>
            </div>`
          : ""
      }
      <div class="row between" style="background:var(--ink); padding:10px 16px; border-radius:8px; margin-top:16px;">
        <strong>Net Salary Payable</strong><strong>${rupees(line.netSalary)}</strong>
      </div>
      <div class="card-grid mt-16">
        <div>
          <h3>Employer Contributions</h3>
          <table>${employerRows || `<tr><td class="text-muted">None</td><td></td></tr>`}</table>
        </div>
        <div>
          <h3>Tax Summary</h3>
          <table>
            <tr><td class="text-muted">Regime Used</td><td>${sentenceCase(line.regimeUsed)}</td></tr>
            <tr><td class="text-muted">Annual Tax Liability</td><td>${rupees(annualTaxLiability)}</td></tr>
            <tr><td class="text-muted">TDS this Month</td><td>${rupees(line.tdsMonthly)}</td></tr>
          </table>
        </div>
      </div>
      <h3 class="mt-16">Year-to-Date Totals (FY ${fy.code}, through ${monthLabel(run)})</h3>
      <table>
        <thead><tr><th>Gross (YTD)</th>${ytdDeductionsByCode.map(([code]) => `<th>${componentLabel(code)} (YTD)</th>`).join("")}<th>TDS (YTD)</th><th>Total Deductions (YTD)</th>${ytdPositiveAdjustmentsTotal ? "<th>Other Additions (YTD)</th>" : ""}<th>Net (YTD)</th></tr></thead>
        <tbody><tr><td>${rupees(ytdGross)}</td>${ytdDeductionsByCode.map(([, amt]) => `<td>${rupees(amt)}</td>`).join("")}<td>${rupees(ytdTds)}</td><td><strong>${rupees(ytdDeductionsTotal)}</strong></td>${ytdPositiveAdjustmentsTotal ? `<td>${rupees(ytdPositiveAdjustmentsTotal)}</td>` : ""}<td>${rupees(ytdNet)}</td></tr></tbody>
      </table>
      <p class="text-muted mt-16" style="text-align:center; font-size:12px;">This is a system-generated payslip and does not require a signature.</p>
    </div>
  `;
}

function renderSalarySlip(container, runId, lineId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  const line = run && run.lines.find((l) => l.id === lineId);
  if (!run || !line) {
    container.innerHTML = `<div class="card">Salary slip not found.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="row between no-print">
      <a href="#/payroll-runs/${runId}"><button>&larr; Back to Payroll Run</button></a>
      <button id="btn-print">Print / Save as PDF</button>
    </div>
    ${buildSlipCardHtml(run, line)}
  `;
  document.getElementById("btn-print").addEventListener("click", () => window.print());
}
