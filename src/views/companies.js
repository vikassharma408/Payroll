// Companies: multi-entity support. Each Company is a separate legal entity
// (own PAN/TAN/bank account); Employees and Payroll Runs each belong to
// exactly one Company via companyId, chosen explicitly on each create-form
// (Employee, Payroll Run, Template, Import). The topbar's eye-icon filter
// (app.js: getCompanyFilter/filteredCompanies) decides which company(ies)
// list/report screens show.

registerView("companies", "Setup", "Companies", renderCompaniesList);
registerDetailView("companies", (container, segments) => {
  const [id] = segments;
  if (id === "new") return renderCompanyForm(container, null);
  const company = db.companies.find((c) => c.id === id);
  if (!company) {
    container.innerHTML = `<div class="card">Company not found. <a href="#/companies">Back to Companies</a></div>`;
    return;
  }
  renderCompanyForm(container, company);
});

function renderCompaniesList(container) {
  const rows = db.companies
    .map((c) => {
      const employeeCount = db.employees.filter((e) => e.companyId === c.id).length;
      return `
      <tr>
        <td><a href="#/companies/${c.id}">${escapeHtml(c.name)}</a></td>
        <td>${c.pan || "-"}</td>
        <td>${c.tan || "-"}</td>
        <td>${employeeCount}</td>
      </tr>`;
    })
    .join("");
  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px;">
      <span class="text-muted">${db.companies.length} compan${db.companies.length === 1 ? "y" : "ies"}. Use the switcher at the top-right to choose which one you're working on.</span>
      <a href="#/companies/new"><button class="primary">+ Add Company</button></a>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>PAN</th><th>TAN</th><th>Employees</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="text-muted">No companies yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderCompanyForm(container, company) {
  const isEdit = !!company;
  const c = company || { name: "", address: "", pan: "", tan: "", bankName: "", bankAccountNo: "", bankIfsc: "" };
  container.innerHTML = `
    <form id="company-form" class="card">
      <h3>${isEdit ? "Edit Company" : "Add Company"}</h3>
      <div class="form-grid">
        <div><label>Company Name *</label><input name="name" required value="${escapeHtml(c.name)}" /></div>
        <div><label>Address</label><input name="address" value="${escapeHtml(c.address || "")}" /></div>
        <div><label>PAN</label><input name="pan" value="${escapeHtml(c.pan || "")}" /></div>
        <div><label>TAN</label><input name="tan" value="${escapeHtml(c.tan || "")}" /></div>
        <div><label>Bank Name</label><input name="bankName" value="${escapeHtml(c.bankName || "")}" /></div>
        <div><label>Bank Account No</label><input name="bankAccountNo" value="${escapeHtml(c.bankAccountNo || "")}" /></div>
        <div><label>Bank IFSC</label><input name="bankIfsc" value="${escapeHtml(c.bankIfsc || "")}" /></div>
      </div>
      <div id="form-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16">
        <button type="submit" class="primary">${isEdit ? "Save Changes" : "Add Company"}</button>
        <a href="#/companies"><button type="button">Cancel</button></a>
        ${isEdit ? `<button type="button" class="danger" id="btn-delete-company" style="margin-left:auto;">Delete</button>` : ""}
      </div>
    </form>
  `;

  document.getElementById("company-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const name = String(fd.get("name") || "").trim();
    const errorEl = document.getElementById("form-error");
    if (!name) {
      errorEl.textContent = "Company name is required.";
      return;
    }
    const data = {
      name,
      address: String(fd.get("address") || "") || null,
      pan: String(fd.get("pan") || "") || null,
      tan: String(fd.get("tan") || "") || null,
      bankName: String(fd.get("bankName") || "") || null,
      bankAccountNo: String(fd.get("bankAccountNo") || "") || null,
      bankIfsc: String(fd.get("bankIfsc") || "") || null,
    };
    let targetId;
    if (isEdit) {
      Object.assign(company, data);
      targetId = company.id;
      logAudit("Company", targetId, "UPDATE", `Updated ${data.name}`);
    } else {
      const newCompany = { id: newId("co"), isActive: true, createdAt: new Date().toISOString(), ...data };
      db.companies.push(newCompany);
      targetId = newCompany.id;
      setActiveCompanyId(targetId);
      logAudit("Company", targetId, "CREATE", `Created ${data.name}`);
    }
    await persist();
    navigate(`companies/${targetId}`);
  });

  const deleteBtn = document.getElementById("btn-delete-company");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const companyEmployeeIds = new Set(db.employees.filter((e) => e.companyId === company.id).map((e) => e.id));
      const hasProcessedPayroll = db.payrollRuns.some((r) => r.companyId === company.id && r.lines.length > 0);
      if (hasProcessedPayroll) {
        alert(`Cannot delete ${company.name}: payroll has already been processed for this company. Payroll history must be preserved.`);
        return;
      }
      if (db.companies.length === 1) {
        alert("Cannot delete the only company. Add another company first if you want to remove this one.");
        return;
      }
      if (!confirm(`Delete ${company.name}? This also removes its ${companyEmployeeIds.size} employee(s) and all their salary structures, declarations, and previous employer records. This cannot be undone.`)) return;

      db.investmentDeclarations = db.investmentDeclarations.filter((d) => !companyEmployeeIds.has(d.employeeId));
      db.previousEmployerIncomes = db.previousEmployerIncomes.filter((p) => !companyEmployeeIds.has(p.employeeId));
      db.employeeSalaryStructures = db.employeeSalaryStructures.filter((s) => !companyEmployeeIds.has(s.employeeId));
      db.employeePerquisites = db.employeePerquisites.filter((p) => !companyEmployeeIds.has(p.employeeId));
      db.payrollRuns = db.payrollRuns.filter((r) => r.companyId !== company.id);
      db.employees = db.employees.filter((e) => e.companyId !== company.id);
      db.companies = db.companies.filter((x) => x.id !== company.id);
      if (getActiveCompanyId() === company.id) setActiveCompanyId(db.companies[0].id);
      logAudit("Company", company.id, "DELETE", `Deleted ${company.name} and its ${companyEmployeeIds.size} employee(s)`);
      await persist();
      navigate("companies");
    });
  }
}
