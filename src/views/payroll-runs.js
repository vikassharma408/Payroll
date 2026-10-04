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
  renderPayrollRunDetail(container, runId);
});

function monthLabel(run) {
  const name = FY_MONTH_NAMES[run.payrollMonthIndex - 1];
  return `${name} ${run.calendarYear}`;
}

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
            <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" id="run-company-all" /> <strong>All Companies</strong></label>
            <hr style="border-color:var(--line);margin:6px 0;" />
            ${db.companies.map((c) => `<label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" class="run-company-item" value="${c.id}" ${c.id === getActiveCompanyId() ? "checked" : ""} /> ${escapeHtml(c.name)}</label>`).join("")}
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
      setActiveCompanyId(companyIds[0]);

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
  let expandedLineId = null;

  function render() {
    const run = db.payrollRuns.find((r) => r.id === runId);
    if (!run) {
      container.innerHTML = `<div class="card">Payroll run not found. <a href="#/payroll-runs">Back to Payroll Runs</a></div>`;
      return;
    }
    const fy = db.financialYears.find((f) => f.id === run.financialYearId);
    const nextStatus = PayrollEngine.PAYROLL_STATUS_ORDER[PayrollEngine.PAYROLL_STATUS_ORDER.indexOf(run.status) + 1];
    const totalNet = run.lines.reduce((s, l) => s + l.netSalary, 0);
    const totalGross = run.lines.reduce((s, l) => s + l.grossSalary, 0);
    const totalTds = run.lines.reduce((s, l) => s + l.tdsMonthly, 0);

    container.innerHTML = `
      <div class="row between">
        <div>
          <h2 style="margin-bottom:2px;">${fy ? fy.code : ""} - ${monthLabel(run)}</h2>
          <div class="text-muted">${run.payrollGroup || "All employees"} · <span class="badge good">${sentenceCase(run.status)}</span></div>
        </div>
        <div class="row gap-8">
          <button id="btn-calculate" ${run.status === "LOCKED" || run.status === "PAID" ? "disabled" : ""}>${run.lines.length ? "Recalculate" : "Run Calculation"}</button>
          ${run.lines.length ? `<a href="#/payroll-runs/${run.id}/register"><button>Salary Register</button></a>` : ""}
          ${run.lines.length ? `<a href="#/payroll-runs/${run.id}/bank-file"><button>Bank Payment File</button></a>` : ""}
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
        <table>
          <thead><tr><th>Employee</th><th>Gross</th><th>Deductions</th><th>TDS</th><th>Adjustments</th><th>Net Pay</th><th>Regime</th><th></th></tr></thead>
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
                    <td>${rupees(l.totalDeductions - l.tdsMonthly)}</td>
                    <td>${rupees(l.tdsMonthly)}</td>
                    <td>${adjTotal ? rupees(adjTotal) : "-"}</td>
                    <td><strong>${rupees(l.netSalary)}</strong></td>
                    <td>${sentenceCase(l.regimeUsed)}</td>
                    <td class="row gap-8">
                      <button data-line="${l.id}" class="toggle-line">${expandedLineId === l.id ? "Hide" : "Details"}</button>
                      <a href="#/payroll-runs/${run.id}/slip/${l.id}"><button>Slip</button></a>
                    </td>
                  </tr>
                  ${expandedLineId === l.id ? `<tr><td colspan="8">${renderLineDetail(l, emp, run)}</td></tr>` : ""}
                `;
                })
                .join("") || `<tr><td colspan="8" class="text-muted">Not calculated yet. Click "Run Calculation" above.</td></tr>`
            }
          </tbody>
        </table>
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

    container.querySelectorAll(".toggle-line").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-line");
        expandedLineId = expandedLineId === id ? null : id;
        render();
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
          const line = PayrollEngine.recalculateLine(db, run.id, employeeId);
          if (wasOverridden) {
            logAudit("PayrollTdsOverride", line.id, "OVERRIDE", `TDS for ${monthLabel(run)} manually set to ${rupees(line.tdsMonthly)} (computed was ${rupees(line.computedTdsMonthly)}): ${tdsOverrideReason}`);
          }
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  // One-time BONUS/INCENTIVE/OVERTIME/ARREARS/OTHER_ALLOWANCE have no
  // structure component to begin with, so they only show up as an editable
  // field once they already have a non-zero value (via Object.keys(line.
  // earnings)) unless always offered - this keeps them available up front
  // without needing a value already set.
  const ALWAYS_OFFERED_EARNING_CODES = ["BONUS", "INCENTIVE", "OVERTIME", "ARREARS", "OTHER_ALLOWANCE"];
  function componentLabel(code) {
    return SLIP_COMPONENT_LABELS[code] || sentenceCase(code);
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
            <div class="text-muted">Days worked ${line.daysWorked}/${line.daysInMonth}${line.lopDays ? ` (LOP: ${line.lopDays})` : ""}</div>
          </div>
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
            <table>${Object.entries(line.deductions).map(([k, v]) => `<tr><td>${componentLabel(k)}</td><td>${rupees(v)}</td></tr>`).join("")}<tr><td>TDS${line.tdsOverridden ? ` <span class="badge bad" title="Manually overridden${line.tdsOverrideReason ? `: ${escapeHtml(line.tdsOverrideReason)}` : ""}. Computed figure was ${rupees(line.computedTdsMonthly)}.">Overridden</span>` : ""}</td><td>${rupees(line.tdsMonthly)}</td></tr></table>
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

  render();
}

// --- Salary Register ---------------------------------------------------
function renderSalaryRegister(container, runId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  if (!run) {
    container.innerHTML = `<div class="card">Payroll run not found.</div>`;
    return;
  }
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
      <h2>Salary Register - ${monthLabel(run)}</h2>
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
function renderBankFile(container, runId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  if (!run) {
    container.innerHTML = `<div class="card">Payroll run not found.</div>`;
    return;
  }
  const { rows, issues, monthLabel: ml } = buildBankFileData(db, runId);
  const templates = db.bankFileTemplates.filter((t) => t.isActive);

  function render(templateCode) {
    const template = templates.find((t) => t.code === templateCode) || templates[0];
    const columns = template.columns;
    container.innerHTML = `
      <div class="row between no-print">
        <a href="#/payroll-runs/${runId}"><button>&larr; Back to Payroll Run</button></a>
        <div class="row gap-8">
          <select id="template-select">${templates.map((t) => `<option value="${t.code}" ${t.code === template.code ? "selected" : ""}>${t.bankName}</option>`).join("")}</select>
          <button id="btn-export-csv">Export CSV</button>
        </div>
      </div>
      ${
        issues.length
          ? `<div class="card text-bad mt-16"><h3>Validation Issues (${issues.length})</h3><ul>${issues.map((i) => `<li>${escapeHtml(i.employeeCode)} - ${escapeHtml(i.employeeName)}: ${escapeHtml(i.issue)}</li>`).join("")}</ul></div>`
          : ""
      }
      <div class="card mt-16">
        <h2>Bank Payment File - ${ml} (${template.bankName})</h2>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>${columns.map((c) => `<th>${c.header}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${c.format === "amount" ? rupees(r[c.field]) : escapeHtml(r[c.field] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById("template-select").addEventListener("change", (e) => render(e.target.value));
    document.getElementById("btn-export-csv").addEventListener("click", () => {
      downloadCsv(`bank-file-${runId}-${template.code}.csv`, columns.map((c) => c.header), rows.map((r) => columns.map((c) => r[c.field])));
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

function renderSalarySlip(container, runId, lineId) {
  const run = db.payrollRuns.find((r) => r.id === runId);
  const line = run && run.lines.find((l) => l.id === lineId);
  if (!run || !line) {
    container.innerHTML = `<div class="card">Salary slip not found.</div>`;
    return;
  }
  const employee = db.employees.find((e) => e.id === line.employeeId);
  const company = db.companies.find((c) => c.id === run.companyId) || db.companies[0] || { name: "", address: "", pan: "", tan: "" };
  const fy = db.financialYears.find((f) => f.id === run.financialYearId);
  const priorLines = db.payrollRuns
    .filter((r) => r.financialYearId === run.financialYearId && r.payrollMonthIndex <= run.payrollMonthIndex)
    .flatMap((r) => r.lines)
    .filter((l) => l.employeeId === line.employeeId);
  const ytd = priorLines.reduce((acc, l) => ({ gross: acc.gross + l.grossSalary, deductions: acc.deductions + l.totalDeductions, tds: acc.tds + l.tdsMonthly, net: acc.net + l.netSalary }), { gross: 0, deductions: 0, tds: 0, net: 0 });
  const adjustmentsTotal = line.adjustments.reduce((s, a) => s + a.amount, 0);
  const annualTaxLiability = line.taxCalcSnapshot[line.regimeUsed.toLowerCase()].totalTaxLiability;

  const earningRows = Object.entries(line.earnings).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${SLIP_COMPONENT_LABELS[code] || code}</td><td>${rupees(amt)}</td></tr>`).join("");
  const employerRows = Object.entries(line.employerContributions).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${SLIP_COMPONENT_LABELS[code] || code}</td><td>${rupees(amt)}</td></tr>`).join("");
  const deductionRows = Object.entries(line.deductions).filter(([, v]) => v !== 0).map(([code, amt]) => `<tr><td>${SLIP_COMPONENT_LABELS[code] || code}</td><td>${rupees(amt)}</td></tr>`).join("");

  container.innerHTML = `
    <div class="row between no-print">
      <a href="#/payroll-runs/${runId}"><button>&larr; Back to Payroll Run</button></a>
      <button id="btn-print">Print / Save as PDF</button>
    </div>
    <div class="card mt-16">
      <div class="row between" style="border-bottom:2px solid var(--line); padding-bottom:8px;">
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(company.name)}</h2>
          <div class="text-muted">${escapeHtml(company.address || "")}</div>
          <div class="text-muted">PAN: ${company.pan || "-"}  TAN: ${company.tan || "-"}</div>
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
          <h3 class="mt-16">Employer Contributions</h3>
          <table>${employerRows || `<tr><td class="text-muted">None</td><td></td></tr>`}</table>
        </div>
        <div>
          <h3>Deductions</h3>
          <table>
            ${deductionRows}
            <tr><td>TDS</td><td>${rupees(line.tdsMonthly)}</td></tr>
            ${adjustmentsTotal !== 0 ? `<tr><td>Adjustments</td><td>${rupees(adjustmentsTotal)}</td></tr>` : ""}
            <tr><td><strong>Total Deductions</strong></td><td><strong>${rupees(line.totalDeductions)}</strong></td></tr>
          </table>
          <h3 class="mt-16">Tax Summary</h3>
          <table>
            <tr><td class="text-muted">Regime Used</td><td>${sentenceCase(line.regimeUsed)}</td></tr>
            <tr><td class="text-muted">Annual Tax Liability</td><td>${rupees(annualTaxLiability)}</td></tr>
            <tr><td class="text-muted">TDS this Month</td><td>${rupees(line.tdsMonthly)}</td></tr>
          </table>
        </div>
      </div>
      <div class="row between" style="background:var(--ink); padding:10px 16px; border-radius:8px; margin-top:16px;">
        <strong>Net Salary Payable</strong><strong>${rupees(line.netSalary)}</strong>
      </div>
      <h3 class="mt-16">Year-to-Date Totals (FY ${fy.code}, through ${monthLabel(run)})</h3>
      <table>
        <thead><tr><th>Gross (YTD)</th><th>Deductions (YTD)</th><th>TDS (YTD)</th><th>Net (YTD)</th></tr></thead>
        <tbody><tr><td>${rupees(ytd.gross)}</td><td>${rupees(ytd.deductions)}</td><td>${rupees(ytd.tds)}</td><td>${rupees(ytd.net)}</td></tr></tbody>
      </table>
      <p class="text-muted mt-16" style="text-align:center; font-size:12px;">This is a system-generated payslip and does not require a signature.</p>
    </div>
  `;
  document.getElementById("btn-print").addEventListener("click", () => window.print());
}
