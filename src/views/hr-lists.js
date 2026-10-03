// Company-wide list screens for Salary Structures, Investment Declarations
// and Previous Employer Income - these sidebar items previously had no real
// view registered (bootstrap.js's generic placeholder caught them), even
// though the underlying data was fully functional via each employee's own
// detail-page tab. These give a single place to see who's set up and who
// isn't, with each row linking straight to the matching tab for detail/edit.

registerView("salary-structures", "Payroll", "Salary Structures", renderSalaryStructuresList);
registerView("investment-declarations", "Payroll", "Investment Declarations", renderInvestmentDeclarationsList);
registerView("previous-employer", "Payroll", "Previous Employer Income", renderPreviousEmployerList);

function renderSalaryStructuresList(container) {
  const company = activeCompany();
  if (!company) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const fy = currentFy();
  const employees = db.employees.filter((e) => e.companyId === company.id && e.status !== "LEFT").sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const rows = employees
    .map((e) => {
      const structure = fy
        ? db.employeeSalaryStructures
            .filter((s) => s.employeeId === e.id && s.financialYearId === fy.id && s.isActive)
            .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0]
        : null;
      return `
      <tr>
        <td><a href="#/employees/${e.id}/salary">${escapeHtml(e.employeeCode)} - ${escapeHtml(e.fullName)}</a></td>
        <td>${structure ? structure.effectiveFrom.slice(0, 10) : "-"}</td>
        <td>${structure ? rupees(structure.annualCTC) : "-"}</td>
        <td>${structure ? structure.components.length : "-"}</td>
        <td>${structure ? '<span class="badge good">Set up</span>' : '<span class="badge bad">Not set up</span>'}</td>
      </tr>`;
    })
    .join("");
  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px;">
      <span class="text-muted">${fy ? `Financial Year ${fy.code}` : "No financial year configured"} - ${employees.length} employee(s) at ${escapeHtml(company.name)}. Click a row to view or edit that employee's full Salary Structure.</span>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Employee</th><th>Effective From</th><th>Annual CTC</th><th>Components</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="text-muted">No employees yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderInvestmentDeclarationsList(container) {
  const company = activeCompany();
  if (!company) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const fy = currentFy();
  const employees = db.employees.filter((e) => e.companyId === company.id && e.status !== "LEFT").sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const rows = employees
    .map((e) => {
      const d = fy ? db.investmentDeclarations.find((x) => x.employeeId === e.id && x.financialYearId === fy.id) : null;
      return `
      <tr>
        <td><a href="#/employees/${e.id}/investment">${escapeHtml(e.employeeCode)} - ${escapeHtml(e.fullName)}</a></td>
        <td>${d && d.monthlyRent ? rupees(d.monthlyRent) : "-"}</td>
        <td>${d ? (d.isMetroCity ? "Yes" : "No") : "-"}</td>
        <td>${d ? sentenceCase(d.proofStatus) : '<span class="badge bad">Not declared</span>'}</td>
      </tr>`;
    })
    .join("");
  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px;">
      <span class="text-muted">${fy ? `Financial Year ${fy.code}` : "No financial year configured"} - ${employees.length} employee(s) at ${escapeHtml(company.name)}. Click a row to view or edit that employee's Investment Declaration.</span>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Employee</th><th>Monthly Rent</th><th>Metro City</th><th>Proof Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="text-muted">No employees yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderPreviousEmployerList(container) {
  const company = activeCompany();
  if (!company) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const fy = currentFy();
  const companyEmployeeIds = new Set(db.employees.filter((e) => e.companyId === company.id).map((e) => e.id));
  const records = (fy ? db.previousEmployerIncomes.filter((p) => p.financialYearId === fy.id) : []).filter((p) => companyEmployeeIds.has(p.employeeId));
  const rows = records
    .map((r) => {
      const e = db.employees.find((x) => x.id === r.employeeId);
      return `
      <tr>
        <td><a href="#/employees/${r.employeeId}/previous-employer">${e ? `${escapeHtml(e.employeeCode)} - ${escapeHtml(e.fullName)}` : "(unknown employee)"}</a></td>
        <td>${escapeHtml(r.employerName)}</td>
        <td>${rupees(r.grossSalary)}</td>
        <td>${rupees(r.taxableSalary)}</td>
        <td>${rupees(r.tdsDeducted)}</td>
      </tr>`;
    })
    .join("");
  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px;">
      <span class="text-muted">${fy ? `Financial Year ${fy.code}` : "No financial year configured"} - ${records.length} record(s) at ${escapeHtml(company.name)}, for employees who joined mid-year with pay/TDS from an earlier employer in the same FY. Click a row to view or edit it on that employee's Previous Employer tab.</span>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Employee</th><th>Previous Employer</th><th>Salary</th><th>Taxable Salary</th><th>TDS Deducted</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="text-muted">No previous employer income declared yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}
