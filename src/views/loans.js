// Loans & Advances register: sanction a loan/advance once, and payroll
// recovers the EMI automatically every month (see loans.js and
// computeEmployeePayrollLine). The balance and history shown here are
// always derived from processed payroll lines plus any repayments recorded
// outside payroll, so they can never drift from what was actually deducted.

registerView("loans", "Payroll", "Loans & Advances", renderLoansList);
registerDetailView("loans", (container, segments) => {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const [id, action] = segments;
  if (id === "new") return renderLoanForm(container, null);
  const loan = db.employeeLoans.find((l) => l.id === id);
  if (!loan) {
    container.innerHTML = `<div class="card"><p>Loan not found. <a href="#/loans">Back to Loans &amp; Advances</a></p></div>`;
    return;
  }
  if (action === "edit") return renderLoanForm(container, loan);
  renderLoanDetail(container, loan);
});

function loanMonthText(year, month) {
  return `${FY_MONTH_NAMES[(month + 8) % 12].slice(0, 3)}-${String(year).slice(-2)}`;
}

function loanStatusBadge(loan, outstanding) {
  if (outstanding < 1) return `<span class="badge good">Fully recovered</span>`;
  if (loan.status === "PAUSED") return `<span class="badge neutral">Recovery paused</span>`;
  if (loan.status === "CLOSED") return `<span class="badge neutral">Closed</span>`;
  return `<span class="badge bad">Active</span>`;
}

function renderLoansList(container) {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const viewCompanyIds = filteredCompanyIds();
  const showCompanyColumn = viewCompanyIds.length > 1;
  const employeeById = new Map(db.employees.map((e) => [e.id, e]));
  const loans = db.employeeLoans
    .filter((l) => {
      const e = employeeById.get(l.employeeId);
      return e && viewCompanyIds.includes(e.companyId);
    })
    .sort((a, b) => (b.sanctionDate || "").localeCompare(a.sanctionDate || ""));
  const rowsData = loans.map((l) => ({ loan: l, employee: employeeById.get(l.employeeId), outstanding: loanOutstandingNow(db, l) }));
  const totalOutstanding = rowsData.reduce((s, r) => s + r.outstanding, 0);
  const activeCount = rowsData.filter((r) => r.outstanding >= 1 && r.loan.status === "ACTIVE").length;
  const monthlyEmi = rowsData.filter((r) => r.outstanding >= 1 && r.loan.status === "ACTIVE").reduce((s, r) => s + Math.min(r.loan.emiAmount, r.outstanding), 0);

  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px; flex-wrap:wrap;">
      <span class="text-muted">Loans and salary advances given to employees at ${escapeHtml(companyFilterLabel())}. EMIs are deducted automatically in every payroll run from the first recovery month until the balance is cleared.</span>
      <a href="#/loans/new"><button class="primary">+ New Loan / Advance</button></a>
    </div>
    <div class="card-grid">
      <div class="card"><div class="stat-label">Active loans</div><div class="stat-value">${activeCount}</div></div>
      <div class="card"><div class="stat-label">Total outstanding</div><div class="stat-value">${rupees(totalOutstanding)}</div></div>
      <div class="card"><div class="stat-label">Monthly EMI recovery</div><div class="stat-value">${rupees(monthlyEmi)}</div></div>
    </div>
    <div class="card">
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Employee</th>${showCompanyColumn ? "<th>Company</th>" : ""}<th>Loan</th><th>Sanctioned</th><th>Principal</th><th>Interest</th><th>EMI</th><th>Outstanding</th><th>Status</th></tr></thead>
        <tbody>
          ${
            rowsData
              .map(
                ({ loan, employee, outstanding }) => `
            <tr>
              <td>${escapeHtml(employee.employeeCode)} - ${escapeHtml(employee.fullName)}</td>
              ${showCompanyColumn ? `<td>${escapeHtml(companyNameOf(employee.companyId))}</td>` : ""}
              <td><a href="#/loans/${loan.id}">${escapeHtml(loanLabel(loan))}</a></td>
              <td>${formatDateDisplay(loan.sanctionDate)}</td>
              <td>${rupees(loan.principal)}</td>
              <td>${loan.interestRatePa ? `${loan.interestRatePa}% p.a.` : "Interest-free"}</td>
              <td>${rupees(loan.emiAmount)}</td>
              <td><strong>${rupees(outstanding)}</strong></td>
              <td>${loanStatusBadge(loan, outstanding)}</td>
            </tr>`,
              )
              .join("") || `<tr><td colspan="${showCompanyColumn ? 9 : 8}" class="text-muted">No loans or advances recorded yet.</td></tr>`
          }
        </tbody>
      </table>
      </div>
    </div>
  `;
}

function renderLoanForm(container, loan) {
  const isEdit = !!loan;
  const viewCompanyIds = filteredCompanyIds();
  const employees = db.employees
    .filter((e) => viewCompanyIds.includes(e.companyId) && e.status !== "LEFT" && e.status !== "INACTIVE")
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = (() => {
    const d = new Date();
    return `${d.getFullYear() + (d.getMonth() === 11 ? 1 : 0)}-${String(((d.getMonth() + 1) % 12) + 1).padStart(2, "0")}`;
  })();
  const v = loan || { employeeId: "", loanType: "PERSONAL", reference: "", principal: "", interestRatePa: 0, sbiRatePa: "", sanctionDate: today, emiAmount: "", notes: "" };
  const firstMonthValue = loan ? `${loan.firstRecoveryYear}-${String(loan.firstRecoveryMonth).padStart(2, "0")}` : nextMonth;
  const hasRecoveries = loan ? loanRecoveryEntries(db, loan).length > 0 : false;

  container.innerHTML = `
    <div style="margin-bottom:12px;"><a href="#/loans${isEdit ? "/" + loan.id : ""}"><button>&larr; Back</button></a></div>
    <form id="loan-form" class="card">
      <h3>${isEdit ? "Edit Loan / Advance" : "New Loan / Advance"}</h3>
      <div class="form-grid">
        <div><label>Employee *</label>
          ${
            isEdit
              ? `<input value="${escapeHtml((db.employees.find((e) => e.id === loan.employeeId) || {}).fullName || "")}" disabled />`
              : `<select name="employeeId" required><option value="">- Select employee -</option>${employees.map((e) => `<option value="${e.id}">${escapeHtml(e.employeeCode)} - ${escapeHtml(e.fullName)}</option>`).join("")}</select>`
          }
        </div>
        <div><label>Type *</label><select name="loanType">${LOAN_TYPES.map((t) => `<option value="${t.key}" ${v.loanType === t.key ? "selected" : ""}>${t.label}</option>`).join("")}</select></div>
        <div><label>Reference / Agreement No.</label><input name="reference" value="${escapeHtml(v.reference || "")}" placeholder="Optional" /></div>
        <div><label>Amount Sanctioned (Rs) *</label><input type="number" min="1" name="principal" value="${v.principal}" required ${hasRecoveries ? "readonly" : ""} /></div>
        <div><label>Sanction Date *</label>${dateField("sanctionDate", v.sanctionDate)}</div>
        <div><label>Interest Charged (% p.a.)</label><input type="number" min="0" step="0.01" name="interestRatePa" value="${v.interestRatePa ?? 0}" /></div>
        <div><label>SBI Rate on 1 April for this loan type (% p.a.)</label><input type="number" min="0" step="0.01" name="sbiRatePa" value="${v.sbiRatePa ?? ""}" placeholder="Needed to value the perquisite" /></div>
        <div><label>First Recovery Month *</label><input type="month" name="firstRecovery" value="${firstMonthValue}" required /></div>
        <div><label>Tenure (months, to suggest EMI)</label><input type="number" min="1" id="loan-tenure" placeholder="e.g. 12" /></div>
        <div><label>Monthly EMI (Rs) *</label>
          <div class="row gap-8"><input type="number" min="1" name="emiAmount" value="${v.emiAmount}" required style="flex:1;" /><button type="button" id="btn-suggest-emi">Suggest</button></div>
        </div>
      </div>
      <div><label class="mt-16">Notes</label><textarea name="notes" rows="2" style="width:100%;">${escapeHtml(v.notes || "")}</textarea></div>
      <p class="text-muted" style="font-size:12px;">Interest (if any) is charged monthly on the reducing balance and recovered first in each EMI. For tax, an interest-free or concessional loan is a perquisite worth (SBI rate - rate charged) on the monthly outstanding balance - nil for medical-treatment loans for specified diseases, or while this employee's loans together stay within Rs 2,00,000 (Income-tax Rules, 2026). It is added to taxable salary automatically.</p>
      <div id="loan-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16"><button type="submit" class="primary">${isEdit ? "Save Changes" : "Sanction Loan"}</button></div>
    </form>
  `;
  wireDateFields(container);

  const form = document.getElementById("loan-form");
  document.getElementById("btn-suggest-emi").addEventListener("click", () => {
    const principal = num(form.principal.value);
    const tenure = num(document.getElementById("loan-tenure").value);
    const errorEl = document.getElementById("loan-error");
    if (!(principal > 0) || !(tenure > 0)) {
      errorEl.textContent = "Enter the amount and a tenure in months to suggest an EMI.";
      return;
    }
    errorEl.textContent = "";
    form.emiAmount.value = suggestLoanEmi(principal, num(form.interestRatePa.value), tenure);
  });

  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(form);
    const errorEl = document.getElementById("loan-error");
    const employeeId = isEdit ? loan.employeeId : String(fd.get("employeeId") || "");
    const principal = num(fd.get("principal"));
    const emiAmount = num(fd.get("emiAmount"));
    const interestRatePa = num(fd.get("interestRatePa"));
    const sanctionDate = String(fd.get("sanctionDate") || "");
    const [fy, fm] = String(fd.get("firstRecovery") || "").split("-").map(Number);
    if (!employeeId) return void (errorEl.textContent = "Select the employee.");
    if (!(principal > 0)) return void (errorEl.textContent = "Enter the amount sanctioned.");
    if (!sanctionDate) return void (errorEl.textContent = "Enter the sanction date.");
    if (!fy || !fm) return void (errorEl.textContent = "Choose the first recovery month.");
    if (loanMonthKey(fy, fm) < loanMonthKey(Number(sanctionDate.slice(0, 4)), Number(sanctionDate.slice(5, 7)))) {
      return void (errorEl.textContent = "The first recovery month can't be before the sanction month.");
    }
    if (!(emiAmount > 0)) return void (errorEl.textContent = "Enter the monthly EMI.");
    const firstInterest = Math.round((principal * interestRatePa) / 1200);
    if (emiAmount <= firstInterest) return void (errorEl.textContent = `The EMI must be more than the first month's interest (Rs ${firstInterest.toLocaleString("en-IN")}), or the loan would never reduce.`);

    const data = {
      loanType: String(fd.get("loanType")),
      reference: String(fd.get("reference") || "").trim() || null,
      principal,
      interestRatePa,
      sbiRatePa: String(fd.get("sbiRatePa") || "").trim() === "" ? null : num(fd.get("sbiRatePa")),
      sanctionDate,
      firstRecoveryYear: fy,
      firstRecoveryMonth: fm,
      emiAmount,
      notes: String(fd.get("notes") || "").trim() || null,
    };
    if (isEdit) {
      Object.assign(loan, data);
      logAudit("EmployeeLoan", loan.id, "UPDATE", `Updated ${loanLabel(loan)}`);
      await persist();
      navigate(`loans/${loan.id}`);
      return;
    }
    const created = { id: newId("loan"), employeeId, status: "ACTIVE", manualRepayments: [], createdAt: new Date().toISOString(), ...data };
    db.employeeLoans.push(created);
    const emp = db.employees.find((e) => e.id === employeeId);
    logAudit("EmployeeLoan", created.id, "CREATE", `${loanLabel(created)} of ${rupees(principal)} sanctioned to ${emp ? emp.fullName : employeeId}, EMI ${rupees(emiAmount)}`);
    await persist();
    navigate(`loans/${created.id}`);
  });
}

function renderLoanDetail(container, loan) {
  const employee = db.employees.find((e) => e.id === loan.employeeId) || {};
  const outstanding = loanOutstandingNow(db, loan);
  const recoveries = loanRecoveryEntries(db, loan);
  const recoveredTotal = recoveries.reduce((s, r) => s + r.amount, 0);
  const interestTotal = recoveries.reduce((s, r) => s + r.interest, 0);
  const schedule = buildLoanSchedule(db, loan, 240);
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="row between" style="margin-bottom:12px; flex-wrap:wrap;">
      <a href="#/loans"><button>&larr; Back to Loans &amp; Advances</button></a>
      <div class="row gap-8">
        <a href="#/loans/${loan.id}/edit"><button>Edit</button></a>
        ${outstanding >= 1 ? `<button id="btn-toggle-pause">${loan.status === "PAUSED" ? "Resume Recovery" : "Pause Recovery"}</button>` : ""}
        ${recoveries.length === 0 && !(loan.manualRepayments || []).length ? `<button class="danger" id="btn-delete-loan">Delete</button>` : ""}
      </div>
    </div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;">
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(loanLabel(loan))}</h2>
          <div class="text-muted"><a href="#/employees/${employee.id}">${escapeHtml(employee.employeeCode || "")} - ${escapeHtml(employee.fullName || "")}</a> · Sanctioned ${formatDateDisplay(loan.sanctionDate)} · ${loan.interestRatePa ? `${loan.interestRatePa}% p.a. reducing balance` : "Interest-free"}</div>
        </div>
        ${loanStatusBadge(loan, outstanding)}
      </div>
      <div class="card-grid mt-16">
        <div><div class="stat-label">Principal</div><div class="stat-value">${rupees(loan.principal)}</div></div>
        <div><div class="stat-label">EMI</div><div class="stat-value">${rupees(loan.emiAmount)}</div></div>
        <div><div class="stat-label">Recovered via payroll</div><div class="stat-value">${rupees(recoveredTotal)}</div><div class="text-muted" style="font-size:12px;">incl. interest ${rupees(interestTotal)}</div></div>
        <div><div class="stat-label">Outstanding</div><div class="stat-value">${rupees(outstanding)}</div></div>
      </div>
      ${loan.notes ? `<p class="text-muted mt-16">${escapeHtml(loan.notes)}</p>` : ""}
      ${loan.loanType !== "MEDICAL" && !loan.sbiRatePa ? `<p class="text-bad mt-16" style="font-size:12px;">No SBI benchmark rate entered - the concessional-loan perquisite can't be valued for tax until you add it (Edit).</p>` : ""}
    </div>

    <div class="card">
      <h3>Repayment Schedule</h3>
      <p class="text-muted" style="font-size:12px;">Recovered rows come from processed payroll; Projected rows assume the EMI continues unchanged. To skip one month's EMI, tick "Hold loan EMI recovery this month" on the employee's line in that payroll run.</p>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Month</th><th>Status</th><th>EMI</th><th>Interest</th><th>Principal</th><th>Balance After</th></tr></thead>
        <tbody>${
          schedule
            .map((r) => `<tr><td>${loanMonthText(r.year, r.month)}</td><td>${r.status === "Projected" ? `<span class="text-muted">Projected</span>` : escapeHtml(r.status)}</td><td>${rupees(r.amount)}</td><td>${rupees(r.interest)}</td><td>${rupees(r.principal)}</td><td>${rupees(r.balanceAfter)}</td></tr>`)
            .join("") || `<tr><td colspan="6" class="text-muted">Nothing outstanding.</td></tr>`
        }</tbody>
      </table>
      </div>
    </div>

    <div class="card">
      <h3>Repayments Outside Payroll</h3>
      <p class="text-muted" style="font-size:12px;">Part-payment or foreclosure paid directly by the employee (cheque, transfer). Reduces the balance from the following payroll month.</p>
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>${
          (loan.manualRepayments || [])
            .map((p) => `<tr><td>${formatDateDisplay(p.date)}</td><td>${rupees(p.amount)}</td><td>${escapeHtml(p.note || "")}</td><td><button class="danger remove-repayment" data-id="${p.id}">Remove</button></td></tr>`)
            .join("") || `<tr><td colspan="4" class="text-muted">None.</td></tr>`
        }</tbody>
      </table>
      ${
        outstanding >= 1
          ? `<form id="repayment-form" class="row gap-8 mt-16" style="flex-wrap:wrap; align-items:flex-end;">
        <div><label>Date</label>${dateField("repaymentDate", today)}</div>
        <div><label>Amount (Rs)</label><input type="number" min="1" name="amount" required /></div>
        <div style="flex:1; min-width:180px;"><label>Note</label><input name="note" placeholder="e.g. Cheque no. / foreclosure" style="width:100%;" /></div>
        <button type="submit">Record Repayment</button>
      </form>
      <div id="repayment-error" class="text-bad mt-16"></div>`
          : ""
      }
    </div>
  `;
  wireDateFields(container);

  const pauseBtn = document.getElementById("btn-toggle-pause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", async () => {
      loan.status = loan.status === "PAUSED" ? "ACTIVE" : "PAUSED";
      logAudit("EmployeeLoan", loan.id, "UPDATE", `${loan.status === "PAUSED" ? "Paused" : "Resumed"} EMI recovery for ${loanLabel(loan)}`);
      await persist();
      renderLoanDetail(container, loan);
    });
  }
  const deleteBtn = document.getElementById("btn-delete-loan");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete this ${loanLabel(loan)}? Nothing has been recovered against it yet.`)) return;
      db.employeeLoans = db.employeeLoans.filter((l) => l.id !== loan.id);
      logAudit("EmployeeLoan", loan.id, "DELETE", `Deleted ${loanLabel(loan)}`);
      await persist();
      navigate("loans");
    });
  }
  container.querySelectorAll(".remove-repayment").forEach((btn) =>
    btn.addEventListener("click", async () => {
      loan.manualRepayments = loan.manualRepayments.filter((p) => p.id !== btn.dataset.id);
      await persist();
      renderLoanDetail(container, loan);
    }),
  );
  const repaymentForm = document.getElementById("repayment-form");
  if (repaymentForm) {
    repaymentForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const fd = new FormData(repaymentForm);
      const amount = num(fd.get("amount"));
      const date = String(fd.get("repaymentDate") || "");
      const errorEl = document.getElementById("repayment-error");
      if (!date || !(amount > 0)) return void (errorEl.textContent = "Enter the date and amount.");
      if (amount > outstanding) return void (errorEl.textContent = `That's more than the outstanding balance (${rupees(outstanding)}).`);
      if (!loan.manualRepayments) loan.manualRepayments = [];
      loan.manualRepayments.push({ id: newId("lrp"), date, amount, note: String(fd.get("note") || "").trim() || null });
      logAudit("EmployeeLoan", loan.id, "REPAYMENT", `${rupees(amount)} repaid outside payroll on ${date} against ${loanLabel(loan)}`);
      await persist();
      renderLoanDetail(container, loan);
    });
  }
}
