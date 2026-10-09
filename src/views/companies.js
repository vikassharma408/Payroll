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

// Scales an uploaded logo down to a modest footprint (fits within
// maxW x maxH, preserving aspect ratio) before it's stored as a data URL in
// IndexedDB and embedded directly in printed payslips - keeps the payslip
// header tidy regardless of how large the source image file was.
function resizeLogoToDataUrl(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read that image file."));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderCompanyForm(container, company) {
  const isEdit = !!company;
  const c = company || { name: "", address: "", pan: "", tan: "", email: "", bankName: "", bankAccountNo: "", bankIfsc: "", branchCode: "", accountType: "CA", logoDataUrl: null };
  let logoDataUrl = c.logoDataUrl || null;
  container.innerHTML = `
    <div class="no-print" style="margin-bottom:12px;">
      <a href="#/companies"><button>&larr; Back to Companies</button></a>
    </div>
    <form id="company-form" class="card">
      <h3>${isEdit ? "Edit Company" : "Add Company"}</h3>
      <div class="form-grid">
        <div><label>Company Name *</label><input name="name" required value="${escapeHtml(c.name)}" /></div>
        <div><label>Address</label><input name="address" value="${escapeHtml(c.address || "")}" /></div>
        <div><label>PAN</label><input name="pan" value="${escapeHtml(c.pan || "")}" /></div>
        <div><label>TAN</label><input name="tan" value="${escapeHtml(c.tan || "")}" /></div>
        <div><label>Email (used on bank payment files)</label><input type="email" name="email" value="${escapeHtml(c.email || "")}" /></div>
        <div><label>Bank Name</label><input name="bankName" value="${escapeHtml(c.bankName || "")}" /></div>
        <div><label>Bank Account No</label><input name="bankAccountNo" value="${escapeHtml(c.bankAccountNo || "")}" /></div>
        <div><label>Bank IFSC</label><input name="bankIfsc" value="${escapeHtml(c.bankIfsc || "")}" /></div>
        <div><label>Bank Branch Code</label><input name="branchCode" value="${escapeHtml(c.branchCode || "")}" placeholder="e.g. 0001" /></div>
        <div><label>Bank Account Type</label>
          <select name="accountType">
            <option value="CA" ${(c.accountType || "CA") === "CA" ? "selected" : ""}>Current Account (CA)</option>
            <option value="SB" ${c.accountType === "SB" ? "selected" : ""}>Savings Account (SB)</option>
            <option value="OD" ${c.accountType === "OD" ? "selected" : ""}>Overdraft (OD)</option>
            <option value="CC" ${c.accountType === "CC" ? "selected" : ""}>Cash Credit (CC)</option>
          </select>
        </div>
        <div>
          <label>Logo (shown on payslips)</label>
          <input type="file" id="logo-input" accept="image/*" />
          <div id="logo-preview" class="row gap-8 mt-16" style="align-items:center;">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo preview" style="max-height:48px; max-width:140px; object-fit:contain;" /><button type="button" id="btn-remove-logo">Remove</button>` : `<span class="text-muted">No logo uploaded.</span>`}
          </div>
        </div>
      </div>
      <div id="form-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16">
        <button type="submit" class="primary">${isEdit ? "Save Changes" : "Add Company"}</button>
        <a href="#/companies"><button type="button">Cancel</button></a>
        ${isEdit ? `<button type="button" class="danger" id="btn-delete-company" style="margin-left:auto;">Delete</button>` : ""}
      </div>
    </form>
  `;

  document.getElementById("logo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = document.getElementById("form-error");
    try {
      logoDataUrl = await resizeLogoToDataUrl(file, 300, 100);
      document.getElementById("logo-preview").innerHTML = `<img src="${logoDataUrl}" alt="Logo preview" style="max-height:48px; max-width:140px; object-fit:contain;" /><button type="button" id="btn-remove-logo">Remove</button>`;
      document.getElementById("btn-remove-logo").addEventListener("click", () => {
        logoDataUrl = null;
        e.target.value = "";
        document.getElementById("logo-preview").innerHTML = `<span class="text-muted">No logo uploaded.</span>`;
      });
    } catch (err) {
      errorEl.textContent = err.message || "Could not read that image file.";
    }
  });
  const removeLogoBtn = document.getElementById("btn-remove-logo");
  if (removeLogoBtn) {
    removeLogoBtn.addEventListener("click", () => {
      logoDataUrl = null;
      document.getElementById("logo-input").value = "";
      document.getElementById("logo-preview").innerHTML = `<span class="text-muted">No logo uploaded.</span>`;
    });
  }

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
      email: String(fd.get("email") || "") || null,
      bankName: String(fd.get("bankName") || "") || null,
      bankAccountNo: String(fd.get("bankAccountNo") || "") || null,
      bankIfsc: String(fd.get("bankIfsc") || "") || null,
      branchCode: String(fd.get("branchCode") || "") || null,
      accountType: String(fd.get("accountType") || "CA"),
    };
    data.logoDataUrl = logoDataUrl;
    let targetId;
    if (isEdit) {
      Object.assign(company, data);
      targetId = company.id;
      logAudit("Company", targetId, "UPDATE", `Updated ${data.name}`);
      await persist();
      navigate("companies");
      return;
    }
    const newCompany = { id: newId("co"), isActive: true, createdAt: new Date().toISOString(), ...data };
    db.companies.push(newCompany);
    targetId = newCompany.id;
    setActiveCompanyId(targetId);
    logAudit("Company", targetId, "CREATE", `Created ${data.name}`);
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
