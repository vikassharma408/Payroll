// Payroll Runs: create a run, calculate it, advance its workflow status,
// inspect each employee's payslip line, and record manual adjustments.
// Mirrors app/payroll/page.tsx + app/payroll/[id]/page.tsx from the Next.js
// version, backed by the ported html-app/src/payroll-engine.js.

registerView("payroll-runs", "Payroll", "Payroll Runs", renderPayrollRunsList);
registerDetailView("payroll-runs", (container, segments) => renderPayrollRunDetail(container, segments[0]));

function monthLabel(run) {
  const name = FY_MONTH_NAMES[run.payrollMonthIndex - 1];
  return `${name} ${run.calendarYear}`;
}

function renderPayrollRunsList(container) {
  const fy = currentFy();
  const runs = db.payrollRuns
    .slice()
    .sort((a, b) => b.payrollMonthIndex - a.payrollMonthIndex);

  const rows = runs
    .map((r) => {
      const fyOfRun = db.financialYears.find((f) => f.id === r.financialYearId);
      const totalNet = r.lines.reduce((s, l) => s + l.netSalary, 0);
      return `
      <tr>
        <td><a href="#/payroll-runs/${r.id}">${fyOfRun ? fyOfRun.code : "-"} - ${monthLabel(r)}</a></td>
        <td>${r.payrollGroup || "All"}</td>
        <td><span class="badge ${r.status === "PAID" ? "good" : r.status === "DRAFT" ? "neutral" : "good"}">${r.status}</span></td>
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
        <div><label>Financial Year</label><input value="${fy.code}" disabled /></div>
        <div><label>Month</label>
          <select name="payrollMonthIndex">
            ${FY_MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join("")}
          </select>
        </div>
        <div><label>Payroll Group (optional)</label><input name="payrollGroup" placeholder="Leave blank for all employees" /></div>
      </div>
      <div class="row gap-8 mt-16"><button type="submit" class="primary">Create Run</button></div>
    </form>`
    }
    <div class="card">
      <table>
        <thead><tr><th>Period</th><th>Group</th><th>Status</th><th>Employees</th><th>Total Net Pay</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="text-muted">No payroll runs yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  const form = document.getElementById("new-run-form");
  if (form) {
    form.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const fd = new FormData(evt.target);
      const payrollMonthIndex = Number(fd.get("payrollMonthIndex"));
      const payrollGroup = String(fd.get("payrollGroup") || "").trim() || null;

      const existing = db.payrollRuns.find((r) => r.financialYearId === fy.id && r.payrollMonthIndex === payrollMonthIndex && r.payrollGroup === payrollGroup);
      if (existing) {
        navigate(`payroll-runs/${existing.id}`);
        return;
      }
      const { calendarYear, calendarMonth } = fyMonthIndexToCalendar(payrollMonthIndex, new Date(fy.startDate).getFullYear());
      const run = {
        id: newId("run"),
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
        lines: [],
      };
      db.payrollRuns.push(run);
      await persist();
      navigate(`payroll-runs/${run.id}`);
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
          <div class="text-muted">${run.payrollGroup || "All employees"} · <span class="badge good">${run.status}</span></div>
        </div>
        <div class="row gap-8">
          <button id="btn-calculate" ${run.status === "LOCKED" || run.status === "PAID" ? "disabled" : ""}>${run.lines.length ? "Recalculate" : "Run Calculation"}</button>
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
                    <td>${l.regimeUsed}</td>
                    <td><button data-line="${l.id}" class="toggle-line">${expandedLineId === l.id ? "Hide" : "Details"}</button></td>
                  </tr>
                  ${expandedLineId === l.id ? `<tr><td colspan="8">${renderLineDetail(l, emp)}</td></tr>` : ""}
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
          PayrollEngine.addAdjustment(db, form.dataset.lineId, {
            amount: num(fd.get("amount")),
            reason: String(fd.get("reason") || ""),
            enteredBy: String(fd.get("enteredBy") || ""),
          });
          await persist();
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function renderLineDetail(line, emp) {
    const snap = line.taxCalcSnapshot[line.regimeUsed.toLowerCase()];
    return `
      <div class="card" style="margin:8px 0;">
        <div class="row between">
          <div>
            <h3 style="margin-bottom:2px;">${emp ? escapeHtml(emp.fullName) : ""}</h3>
            <div class="text-muted">Days worked ${line.daysWorked}/${line.daysInMonth}${line.lopDays ? ` (LOP: ${line.lopDays})` : ""}</div>
          </div>
        </div>
        <div class="card-grid mt-16">
          <div>
            <h3>Earnings</h3>
            <table>${Object.entries(line.earnings).map(([k, v]) => `<tr><td>${k}</td><td>${rupees(v)}</td></tr>`).join("")}</table>
          </div>
          <div>
            <h3>Deductions</h3>
            <table>${Object.entries(line.deductions).map(([k, v]) => `<tr><td>${k}</td><td>${rupees(v)}</td></tr>`).join("")}<tr><td>TDS</td><td>${rupees(line.tdsMonthly)}</td></tr></table>
          </div>
          <div>
            <h3>Employer Contributions</h3>
            <table>${Object.entries(line.employerContributions).map(([k, v]) => `<tr><td>${k}</td><td>${rupees(v)}</td></tr>`).join("")}</table>
          </div>
        </div>
        ${
          snap
            ? `<details class="mt-16"><summary>Tax calculation trace (${line.regimeUsed} regime, annualized)</summary>
              <table class="mt-16">${snap.steps.map((s) => `<tr><td>${s.label}${s.note ? ` <span class="text-muted">(${s.note})</span>` : ""}</td><td>${rupees(s.amount)}</td></tr>`).join("")}</table>
            </details>`
            : ""
        }
        <h3 class="mt-16">Adjustments</h3>
        <table>
          ${line.adjustments.map((a) => `<tr><td>${a.createdAt.slice(0, 10)}</td><td>${escapeHtml(a.reason)}</td><td>${escapeHtml(a.enteredBy)}</td><td>${rupees(a.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">No adjustments.</td></tr>`}
        </table>
        <form class="adjustment-form row gap-8 mt-16" data-line-id="${line.id}">
          <input type="number" name="amount" placeholder="Amount (+/-)" required style="max-width:140px;" />
          <input name="reason" placeholder="Reason" required style="flex:1;" />
          <input name="enteredBy" placeholder="Entered by" required style="max-width:140px;" />
          <button type="submit" class="primary">Add Adjustment</button>
        </form>
      </div>
    `;
  }

  render();
}
