// Employees: list, add/edit profile, and the per-employee workspace (Salary
// Structure, Investment Declaration, Previous Employer Income, Regime
// Comparison) - mirrors app/employees/page.tsx + app/employees/[id]/page.tsx
// from the Next.js version, field-for-field against prisma/schema.prisma.

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function currentFy() {
  return db.financialYears.find((f) => f.isCurrent) || db.financialYears[0];
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

registerView("employees", "Payroll", "Employees", renderEmployeesList);
registerDetailView("employees", (container, segments) => {
  if (!activeCompany()) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> before adding employees.</p></div>`;
    return;
  }
  const [id, action] = segments;
  if (id === "new") return renderEmployeeForm(container, null);
  const employee = db.employees.find((e) => e.id === id);
  if (!employee) {
    container.innerHTML = `<div class="card"><p>Employee not found. <a href="#/employees">Back to Employees</a></p></div>`;
    return;
  }
  if (action === "edit") return renderEmployeeForm(container, employee);
  renderEmployeeDetail(container, employee);
});

function renderEmployeesList(container) {
  const company = activeCompany();
  if (!company) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const companyEmployees = db.employees.filter((e) => e.companyId === company.id).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const rows = companyEmployees
    .map(
      (e) => `
      <tr>
        <td><a href="#/employees/${e.id}">${escapeHtml(e.employeeCode)}</a></td>
        <td><a href="#/employees/${e.id}">${escapeHtml(e.fullName)}</a></td>
        <td>${escapeHtml(e.designation || "-")}</td>
        <td>${escapeHtml(e.department || "-")}</td>
        <td>${e.taxRegime}</td>
        <td><span class="badge ${e.status === "ACTIVE" ? "good" : e.status === "LEFT" ? "bad" : "neutral"}">${e.status}</span></td>
      </tr>`,
    )
    .join("");
  container.innerHTML = `
    <div class="row between mt-16" style="margin-bottom:16px;">
      <span class="text-muted">${company.name}: ${companyEmployees.length} employee(s)</span>
      <a href="#/employees/new"><button class="primary">+ Add Employee</button></a>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Regime</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="text-muted">No employees yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderEmployeeForm(container, employee) {
  const isEdit = !!employee;
  const e = employee || {
    employeeCode: "",
    fullName: "",
    dob: "",
    gender: "",
    pan: "",
    aadhaar: "",
    email: "",
    phone: "",
    dateOfJoining: "",
    dateOfLeaving: "",
    department: "",
    designation: "",
    location: "",
    costCentre: "",
    payrollGroup: "",
    uan: "",
    pfApplicable: true,
    esiApplicable: false,
    ptApplicable: true,
    taxRegime: "NEW",
    status: "ACTIVE",
    bankName: "",
    bankAccountNo: "",
    bankIfsc: "",
    isMetroCity: false,
  };

  container.innerHTML = `
    <form id="employee-form" class="card">
      <h3>${isEdit ? "Edit Employee" : "Add Employee"}</h3>
      <div class="form-grid">
        <div><label>Employee Code *</label><input name="employeeCode" required value="${escapeHtml(e.employeeCode)}" /></div>
        <div><label>Full Name *</label><input name="fullName" required value="${escapeHtml(e.fullName)}" /></div>
        <div><label>Date of Birth</label><input type="date" name="dob" value="${e.dob || ""}" /></div>
        <div><label>Gender</label>
          <select name="gender">
            <option value="" ${!e.gender ? "selected" : ""}>-</option>
            <option value="MALE" ${e.gender === "MALE" ? "selected" : ""}>Male</option>
            <option value="FEMALE" ${e.gender === "FEMALE" ? "selected" : ""}>Female</option>
            <option value="OTHER" ${e.gender === "OTHER" ? "selected" : ""}>Other</option>
          </select>
        </div>
        <div><label>PAN</label><input name="pan" value="${escapeHtml(e.pan || "")}" placeholder="AAAAA9999A" style="text-transform:uppercase;" /></div>
        <div><label>Aadhaar</label><input name="aadhaar" value="${escapeHtml(e.aadhaar || "")}" /></div>
        <div><label>Email</label><input type="email" name="email" value="${escapeHtml(e.email || "")}" /></div>
        <div><label>Phone</label><input name="phone" value="${escapeHtml(e.phone || "")}" /></div>
        <div><label>Date of Joining *</label><input type="date" name="dateOfJoining" required value="${e.dateOfJoining || ""}" /></div>
        <div><label>Date of Leaving</label><input type="date" name="dateOfLeaving" value="${e.dateOfLeaving || ""}" /></div>
        <div><label>Department</label><input name="department" value="${escapeHtml(e.department || "")}" /></div>
        <div><label>Designation</label><input name="designation" value="${escapeHtml(e.designation || "")}" /></div>
        <div><label>Location</label><input name="location" value="${escapeHtml(e.location || "")}" /></div>
        <div><label>Cost Centre</label><input name="costCentre" value="${escapeHtml(e.costCentre || "")}" /></div>
        <div><label>Payroll Group</label><input name="payrollGroup" value="${escapeHtml(e.payrollGroup || "")}" /></div>
        <div><label>UAN</label><input name="uan" value="${escapeHtml(e.uan || "")}" /></div>
        <div><label>Tax Regime (for TDS)</label>
          <select name="taxRegime">
            <option value="NEW" ${e.taxRegime === "NEW" ? "selected" : ""}>New Regime</option>
            <option value="OLD" ${e.taxRegime === "OLD" ? "selected" : ""}>Old Regime</option>
          </select>
        </div>
        <div><label>Status</label>
          <select name="status">
            <option value="ACTIVE" ${e.status === "ACTIVE" ? "selected" : ""}>Active</option>
            <option value="INACTIVE" ${e.status === "INACTIVE" ? "selected" : ""}>Inactive</option>
            <option value="LEFT" ${e.status === "LEFT" ? "selected" : ""}>Left</option>
          </select>
        </div>
        <div><label>Bank Name</label><input name="bankName" value="${escapeHtml(e.bankName || "")}" /></div>
        <div><label>Bank Account No</label><input name="bankAccountNo" value="${escapeHtml(e.bankAccountNo || "")}" /></div>
        <div><label>Bank IFSC</label><input name="bankIfsc" value="${escapeHtml(e.bankIfsc || "")}" placeholder="AAAA0999999" style="text-transform:uppercase;" /></div>
      </div>
      <div class="row gap-8 mt-16">
        <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="pfApplicable" ${e.pfApplicable ? "checked" : ""} style="width:auto;" /> PF Applicable</label>
        <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="esiApplicable" ${e.esiApplicable ? "checked" : ""} style="width:auto;" /> ESI Applicable</label>
        <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="ptApplicable" ${e.ptApplicable ? "checked" : ""} style="width:auto;" /> PT Applicable</label>
        <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="isMetroCity" ${e.isMetroCity ? "checked" : ""} style="width:auto;" /> Metro City (for HRA)</label>
      </div>
      <div id="form-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16">
        <button type="submit" class="primary">${isEdit ? "Save Changes" : "Add Employee"}</button>
        <a href="#/${isEdit ? "employees/" + employee.id : "employees"}"><button type="button">Cancel</button></a>
      </div>
    </form>
  `;

  document.getElementById("employee-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const errorEl = document.getElementById("form-error");
    errorEl.textContent = "";

    const employeeCode = String(fd.get("employeeCode") || "").trim();
    const fullName = String(fd.get("fullName") || "").trim();
    const dateOfJoining = String(fd.get("dateOfJoining") || "");
    const pan = String(fd.get("pan") || "").trim().toUpperCase();
    const bankIfsc = String(fd.get("bankIfsc") || "").trim().toUpperCase();

    if (!employeeCode || !fullName || !dateOfJoining) {
      errorEl.textContent = "Employee code, full name and date of joining are required.";
      return;
    }
    if (pan && !PAN_REGEX.test(pan)) {
      errorEl.textContent = "PAN must match AAAAA9999A format.";
      return;
    }
    if (bankIfsc && !IFSC_REGEX.test(bankIfsc)) {
      errorEl.textContent = "IFSC must match AAAA0999999 format.";
      return;
    }
    const companyId = isEdit ? employee.companyId : getActiveCompanyId();
    const dup = db.employees.find((x) => x.companyId === companyId && x.employeeCode === employeeCode && (!isEdit || x.id !== employee.id));
    if (dup) {
      errorEl.textContent = `Employee code '${employeeCode}' already exists in this company.`;
      return;
    }
    if (pan) {
      const dupPan = db.employees.find((x) => x.companyId === companyId && x.pan === pan && (!isEdit || x.id !== employee.id));
      if (dupPan) {
        errorEl.textContent = `PAN '${pan}' is already used by another employee in this company.`;
        return;
      }
    }

    const data = {
      employeeCode,
      fullName,
      dob: String(fd.get("dob") || "") || null,
      gender: String(fd.get("gender") || "") || null,
      pan: pan || null,
      aadhaar: String(fd.get("aadhaar") || "") || null,
      email: String(fd.get("email") || "") || null,
      phone: String(fd.get("phone") || "") || null,
      dateOfJoining,
      dateOfLeaving: String(fd.get("dateOfLeaving") || "") || null,
      department: String(fd.get("department") || "") || null,
      designation: String(fd.get("designation") || "") || null,
      location: String(fd.get("location") || "") || null,
      costCentre: String(fd.get("costCentre") || "") || null,
      payrollGroup: String(fd.get("payrollGroup") || "") || null,
      uan: String(fd.get("uan") || "") || null,
      pfApplicable: fd.get("pfApplicable") === "on",
      esiApplicable: fd.get("esiApplicable") === "on",
      ptApplicable: fd.get("ptApplicable") === "on",
      taxRegime: String(fd.get("taxRegime") || "NEW"),
      status: String(fd.get("status") || "ACTIVE"),
      isMetroCity: fd.get("isMetroCity") === "on",
      bankName: String(fd.get("bankName") || "") || null,
      bankAccountNo: String(fd.get("bankAccountNo") || "") || null,
      bankIfsc: bankIfsc || null,
    };

    let targetId;
    if (isEdit) {
      Object.assign(employee, data);
      targetId = employee.id;
    } else {
      const newEmployee = { id: newId("emp"), companyId, ageCategory: "BELOW_60", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data };
      db.employees.push(newEmployee);
      targetId = newEmployee.id;
    }
    await persist();
    navigate(`employees/${targetId}`);
  });
}

function renderEmployeeDetail(container, employee) {
  let activeTab = "profile";
  const TABS = [
    ["profile", "Profile"],
    ["salary", "Salary Structure"],
    ["investment", "Investment Declaration"],
    ["previous-employer", "Previous Employer"],
    ["regime", "Regime Comparison"],
  ];

  function render() {
    const fy = currentFy();
    container.innerHTML = `
      <div class="row between">
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(employee.fullName)} <span class="text-muted" style="font-size:14px;">(${escapeHtml(employee.employeeCode)})</span></h2>
          <div class="text-muted">${escapeHtml(employee.designation || "")}${employee.department ? " · " + escapeHtml(employee.department) : ""}</div>
        </div>
        <div class="row gap-8">
          <a href="#/employees/${employee.id}/edit"><button>Edit Profile</button></a>
          <button class="danger" id="btn-delete-employee">Delete</button>
        </div>
      </div>
      ${!fy ? `<div class="card text-bad mt-16">No Financial Year is configured yet - salary structure, investment declaration and payroll features need one. This should have been seeded automatically; try Backup &amp; Restore to reload the app's defaults.</div>` : ""}
      <div class="row gap-8 mt-16" style="border-bottom:1px solid var(--line); padding-bottom:0;">
        ${TABS.map(([key, label]) => `<button data-tab="${key}" style="border-radius:6px 6px 0 0; ${activeTab === key ? "border-color:var(--gold);color:var(--gold);" : ""}">${label}</button>`).join("")}
      </div>
      <div id="tab-content" class="mt-16"></div>
    `;

    container.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.getAttribute("data-tab");
        render();
      });
    });

    document.getElementById("btn-delete-employee").addEventListener("click", async () => {
      const processedLine = db.payrollRuns
        .flatMap((r) => r.lines.map((l) => ({ line: l, run: r })))
        .find((x) => x.line.employeeId === employee.id);
      if (processedLine) {
        const fyCode = (db.financialYears.find((f) => f.id === processedLine.run.financialYearId) || {}).code || "?";
        alert(
          `Cannot delete ${employee.fullName} (${employee.employeeCode}): payroll has already been processed for them (FY ${fyCode}, month ${processedLine.run.payrollMonthIndex}, status ${processedLine.run.status}). Payroll history must be preserved. Set their status to Inactive or Left instead of deleting them.`,
        );
        return;
      }
      if (!confirm(`Delete ${employee.fullName}? This also removes their salary structure, investment declaration and previous employer records. This cannot be undone.`)) return;
      db.investmentDeclarations = db.investmentDeclarations.filter((d) => d.employeeId !== employee.id);
      db.previousEmployerIncomes = db.previousEmployerIncomes.filter((p) => p.employeeId !== employee.id);
      db.employeeSalaryStructures = db.employeeSalaryStructures.filter((s) => s.employeeId !== employee.id);
      db.employees = db.employees.filter((e) => e.id !== employee.id);
      await persist();
      navigate("employees");
    });

    const tabContent = document.getElementById("tab-content");
    if (!fy) return;
    if (activeTab === "profile") renderProfileTab(tabContent, employee);
    else if (activeTab === "salary") renderSalaryStructureTab(tabContent, employee, fy, render);
    else if (activeTab === "investment") renderInvestmentDeclarationTab(tabContent, employee, fy, render);
    else if (activeTab === "previous-employer") renderPreviousEmployerTab(tabContent, employee, fy, render);
    else if (activeTab === "regime") renderRegimeComparisonTab(tabContent, employee, fy);
  }

  render();
}

function renderProfileTab(container, e) {
  const field = (label, value) => `<div><div class="stat-label">${label}</div><div>${value || '<span class="text-muted">-</span>'}</div></div>`;
  container.innerHTML = `
    <div class="card card-grid">
      ${field("Date of Birth", e.dob)}
      ${field("Gender", e.gender)}
      ${field("PAN", e.pan)}
      ${field("Aadhaar", e.aadhaar)}
      ${field("Email", escapeHtml(e.email || ""))}
      ${field("Phone", e.phone)}
      ${field("Date of Joining", e.dateOfJoining)}
      ${field("Date of Leaving", e.dateOfLeaving)}
      ${field("Location", e.location)}
      ${field("Cost Centre", e.costCentre)}
      ${field("Payroll Group", e.payrollGroup)}
      ${field("UAN", e.uan)}
      ${field("PF / ESI / PT Applicable", `${e.pfApplicable ? "PF" : ""} ${e.esiApplicable ? "ESI" : ""} ${e.ptApplicable ? "PT" : ""}`.trim() || "None")}
      ${field("Metro City", e.isMetroCity ? "Yes" : "No")}
      ${field("Bank", e.bankName ? `${e.bankName} · ${e.bankAccountNo || ""} · ${e.bankIfsc || ""}` : "")}
    </div>
  `;
}

// --- Salary Structure ------------------------------------------------------
function renderSalaryStructureTab(container, employee, fy, onSaved) {
  const active = db.employeeSalaryStructures
    .filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];

  let ctc = active ? active.annualCTC : 0;
  // Editable rows are re-derived from the stored components as fixed annual
  // amounts (the formula trace is display-only, not re-parsed back into a
  // formula string); the user can switch a row back to "Formula" mode and
  // re-enter it if they want to keep it formula-driven going forward.
  let rows = active ? active.components.map((c) => ({ componentId: c.componentId, componentCode: c.componentCode, isFormula: false, formula: "", fixedAnnualAmount: c.annualAmount })) : [];

  function render() {
    const options = db.salaryComponents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => `<option value="${c.id}">${c.code} - ${c.name} (${c.category})</option>`)
      .join("");

    container.innerHTML = `
      <div class="card">
        <div class="form-grid">
          <div><label>Annual CTC</label><input type="number" id="ctc-input" value="${ctc}" min="0" /></div>
        </div>
        <table class="mt-16">
          <thead><tr><th>Component</th><th>Category</th><th>Mode</th><th>Value</th><th>Monthly (preview)</th><th></th></tr></thead>
          <tbody id="rows-body"></tbody>
        </table>
        <div class="row gap-8 mt-16">
          <select id="add-component-select">${options}</select>
          <button id="btn-add-row">+ Add Component</button>
        </div>
        <div id="structure-error" class="text-bad mt-16"></div>
        <div class="row gap-8 mt-16">
          <button class="primary" id="btn-save-structure">Save Structure</button>
        </div>
      </div>
      ${
        db.employeeSalaryStructures.filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id).length > 1
          ? `<div class="card"><h3>Structure History</h3>${renderStructureHistory()}</div>`
          : ""
      }
    `;
    renderRows();
    document.getElementById("ctc-input").addEventListener("input", (e) => {
      ctc = num(e.target.value);
      renderRows();
    });
    document.getElementById("btn-add-row").addEventListener("click", () => {
      const select = document.getElementById("add-component-select");
      const comp = db.salaryComponents.find((c) => c.id === select.value);
      if (!comp || rows.some((r) => r.componentId === comp.id)) return;
      rows.push({ componentId: comp.id, componentCode: comp.code, isFormula: false, formula: "", fixedAnnualAmount: 0 });
      renderRows();
    });
    document.getElementById("btn-save-structure").addEventListener("click", async () => {
      const errorEl = document.getElementById("structure-error");
      errorEl.textContent = "";
      if (rows.length === 0) {
        errorEl.textContent = "Add at least one salary component.";
        return;
      }
      try {
        const defs = rows.map((r) => ({ code: r.componentCode, formula: r.isFormula ? r.formula : null, fixedAnnualAmount: r.isFormula ? undefined : r.fixedAnnualAmount || 0 }));
        const resolved = resolveSalaryStructure(ctc, defs);
        const now = new Date().toISOString();
        for (const s of db.employeeSalaryStructures) {
          if (s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive) {
            s.isActive = false;
            s.effectiveTo = now;
          }
        }
        const structure = {
          id: newId("ess"),
          employeeId: employee.id,
          financialYearId: fy.id,
          annualCTC: ctc,
          effectiveFrom: now,
          effectiveTo: null,
          isActive: true,
          createdAt: now,
          components: rows.map((r) => {
            const comp = db.salaryComponents.find((c) => c.id === r.componentId);
            const res = resolved[r.componentCode];
            return { componentId: r.componentId, componentCode: r.componentCode, category: comp.category, monthlyAmount: res.monthlyAmount, annualAmount: res.annualAmount, formulaUsed: res.formulaTrace };
          }),
        };
        db.employeeSalaryStructures.push(structure);
        await persist();
        onSaved();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  function renderRows() {
    const tbody = document.getElementById("rows-body");
    let preview = {};
    try {
      const defs = rows.map((r) => ({ code: r.componentCode, formula: r.isFormula ? r.formula : null, fixedAnnualAmount: r.isFormula ? undefined : r.fixedAnnualAmount || 0 }));
      preview = resolveSalaryStructure(ctc, defs);
    } catch {
      preview = {};
    }
    tbody.innerHTML = rows
      .map((r, i) => {
        const comp = db.salaryComponents.find((c) => c.id === r.componentId);
        const monthly = preview[r.componentCode] ? money(preview[r.componentCode].monthlyAmount) : "-";
        return `
        <tr>
          <td>${comp.code} - ${comp.name}</td>
          <td>${comp.category}</td>
          <td>
            <select data-idx="${i}" class="mode-select">
              <option value="fixed" ${!r.isFormula ? "selected" : ""}>Fixed (annual)</option>
              <option value="formula" ${r.isFormula ? "selected" : ""}>Formula</option>
            </select>
          </td>
          <td>
            ${
              r.isFormula
                ? `<input data-idx="${i}" class="formula-input" placeholder="e.g. 40% of CTC" value="${escapeHtml(r.formula)}" />`
                : `<input data-idx="${i}" type="number" class="fixed-input" value="${r.fixedAnnualAmount}" />`
            }
          </td>
          <td>${monthly}</td>
          <td><button data-idx="${i}" class="danger remove-row">Remove</button></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".mode-select").forEach((el) =>
      el.addEventListener("change", (e) => {
        rows[Number(e.target.dataset.idx)].isFormula = e.target.value === "formula";
        renderRows();
      }),
    );
    tbody.querySelectorAll(".formula-input").forEach((el) =>
      el.addEventListener("input", (e) => {
        rows[Number(e.target.dataset.idx)].formula = e.target.value;
        renderRows();
      }),
    );
    tbody.querySelectorAll(".fixed-input").forEach((el) =>
      el.addEventListener("input", (e) => {
        rows[Number(e.target.dataset.idx)].fixedAnnualAmount = num(e.target.value);
        renderRows();
      }),
    );
    tbody.querySelectorAll(".remove-row").forEach((el) =>
      el.addEventListener("click", (e) => {
        rows.splice(Number(e.target.dataset.idx), 1);
        renderRows();
      }),
    );
  }

  function renderStructureHistory() {
    return `
      <table>
        <thead><tr><th>Effective From</th><th>Effective To</th><th>CTC</th><th>Status</th></tr></thead>
        <tbody>
          ${db.employeeSalaryStructures
            .filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id)
            .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))
            .map((s) => `<tr><td>${s.effectiveFrom.slice(0, 10)}</td><td>${s.effectiveTo ? s.effectiveTo.slice(0, 10) : "-"}</td><td>${rupees(s.annualCTC)}</td><td>${s.isActive ? '<span class="badge good">Active</span>' : '<span class="badge neutral">Superseded</span>'}</td></tr>`)
            .join("")}
        </tbody>
      </table>
    `;
  }

  render();
}

// --- Investment Declaration -------------------------------------------------
const INVESTMENT_FIELDS = [
  ["Section 80C basket", [
    ["lic", "LIC Premium"], ["epf", "EPF (voluntary)"], ["ppf", "PPF"], ["elss", "ELSS"],
    ["lifeInsurance", "Life Insurance"], ["tuitionFees", "Tuition Fees"], ["housingLoanPrincipal", "Housing Loan Principal"],
    ["otherSection80C", "Other 80C"], ["section80CCC", "80CCC (Pension Fund)"], ["section80CCD1", "80CCD(1) NPS Employee"],
  ]],
  ["Additional NPS", [["section80CCD1B", "80CCD(1B) Additional NPS"]]],
  ["Section 80D (Medical Insurance)", [
    ["section80DSelfBelow60", "Self/Family (below 60)"], ["section80DParentsBelow60", "Parents (below 60)"],
    ["section80DSelfAbove60", "Self/Family (60+)"], ["section80DParentsAbove60", "Parents (60+)"],
  ]],
  ["Other Deductions", [
    ["section80E", "80E Education Loan Interest"], ["section80EE", "80EE Home Loan Interest"], ["section80EEA", "80EEA Home Loan Interest"],
    ["section80UBelow80", "80U Self Disability (<80%)"], ["section80U80AndAbove", "80U Self Disability (80%+)"],
    ["section80DDBelow80", "80DD Dependent Disability (<80%)"], ["section80DD80AndAbove", "80DD Dependent Disability (80%+)"],
    ["donations80G", "80G Donations"], ["otherDeductions", "Other Deductions"], ["ltaClaimed", "LTA Claimed"],
  ]],
  ["House Property", [
    ["homeLoanInterestSelfOccupied", "Home Loan Interest (Self-Occupied)"],
    ["letOutAnnualValue", "Let-Out: Annual Value"], ["letOutMunicipalTax", "Let-Out: Municipal Tax"], ["letOutHomeLoanInterest", "Let-Out: Home Loan Interest"],
  ]],
];

function renderInvestmentDeclarationTab(container, employee, fy, onSaved) {
  const existing = db.investmentDeclarations.find((d) => d.employeeId === employee.id && d.financialYearId === fy.id);
  const d = existing || {};

  const numFieldGroups = INVESTMENT_FIELDS.map(
    ([groupLabel, fields]) => `
    <div class="card">
      <h3>${groupLabel}</h3>
      <div class="form-grid">
        ${fields.map(([key, label]) => `<div><label>${label}</label><input type="number" min="0" name="${key}" value="${d[key] || 0}" /></div>`).join("")}
      </div>
    </div>`,
  ).join("");

  container.innerHTML = `
    <form id="investment-form">
      <div class="card">
        <h3>HRA / Rent</h3>
        <div class="form-grid">
          <div><label>Monthly Rent</label><input type="number" min="0" name="monthlyRent" value="${d.monthlyRent || 0}" /></div>
          <div><label>Rent Start Date</label><input type="date" name="rentStartDate" value="${d.rentStartDate || ""}" /></div>
          <div><label>Rent End Date (if moved out during the FY)</label><input type="date" name="rentEndDate" value="${d.rentEndDate || ""}" /></div>
          <div><label>Rental Address</label><input name="rentalAddress" value="${escapeHtml(d.rentalAddress || "")}" /></div>
          <div><label>Landlord Name</label><input name="landlordName" value="${escapeHtml(d.landlordName || "")}" /></div>
          <div><label>Landlord PAN</label><input name="landlordPan" value="${escapeHtml(d.landlordPan || "")}" /></div>
        </div>
        <p class="text-muted mt-16" style="font-size:12px;">Leave Start/End Date blank if rent was paid for the entire financial year. If set, HRA exemption is only calculated for the months within this period (e.g. if rent started in July, April-June get no HRA exemption).</p>
      </div>
      ${numFieldGroups}
      <div class="card">
        <label>Proof Status</label>
        <select name="proofStatus">
          ${["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"].map((s) => `<option value="${s}" ${d.proofStatus === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="row gap-8">
        <button type="submit" class="primary">Save Investment Declaration</button>
      </div>
    </form>
  `;

  document.getElementById("investment-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const record = existing || { id: newId("inv"), employeeId: employee.id, financialYearId: fy.id, createdAt: new Date().toISOString() };
    for (const [, fields] of INVESTMENT_FIELDS) {
      for (const [key] of fields) record[key] = num(fd.get(key));
    }
    record.monthlyRent = num(fd.get("monthlyRent"));
    record.rentStartDate = String(fd.get("rentStartDate") || "") || null;
    record.rentEndDate = String(fd.get("rentEndDate") || "") || null;
    record.rentalAddress = String(fd.get("rentalAddress") || "") || null;
    record.landlordName = String(fd.get("landlordName") || "") || null;
    record.landlordPan = String(fd.get("landlordPan") || "") || null;
    record.proofStatus = String(fd.get("proofStatus") || "PENDING");
    record.updatedAt = new Date().toISOString();
    if (!existing) db.investmentDeclarations.push(record);
    await persist();
    onSaved();
  });
}

// --- Previous Employer Income ----------------------------------------------
function renderPreviousEmployerTab(container, employee, fy, onSaved) {
  const records = db.previousEmployerIncomes.filter((p) => p.employeeId === employee.id && p.financialYearId === fy.id);
  container.innerHTML = `
    <div class="card">
      <table>
        <thead><tr><th>Employer</th><th>Period</th><th>Gross</th><th>Taxable</th><th>TDS Deducted</th><th></th></tr></thead>
        <tbody>
          ${
            records
              .map(
                (r) => `<tr>
                <td>${escapeHtml(r.employerName)}</td>
                <td>${r.periodFrom} to ${r.periodTo}</td>
                <td>${rupees(r.grossSalary)}</td>
                <td>${rupees(r.taxableSalary)}</td>
                <td>${rupees(r.tdsDeducted)}</td>
                <td><button class="danger remove-prev" data-id="${r.id}">Remove</button></td>
              </tr>`,
              )
              .join("") || `<tr><td colspan="6" class="text-muted">No previous employer records for FY ${fy.code}.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <form id="prev-employer-form" class="card">
      <h3>Add Previous Employer Record</h3>
      <div class="form-grid">
        <div><label>Employer Name *</label><input name="employerName" required /></div>
        <div><label>Period From *</label><input type="date" name="periodFrom" required /></div>
        <div><label>Period To *</label><input type="date" name="periodTo" required /></div>
        <div><label>Gross Salary *</label><input type="number" min="0" name="grossSalary" required /></div>
        <div><label>Taxable Salary *</label><input type="number" min="0" name="taxableSalary" required /></div>
        <div><label>Exemptions</label><input type="number" min="0" name="exemptions" value="0" /></div>
        <div><label>Deductions</label><input type="number" min="0" name="deductions" value="0" /></div>
        <div><label>TDS Deducted</label><input type="number" min="0" name="tdsDeducted" value="0" /></div>
        <div><label>PF Deducted</label><input type="number" min="0" name="pfDeducted" value="0" /></div>
        <div><label>Notes</label><input name="notes" /></div>
      </div>
      <div class="row gap-8 mt-16"><button type="submit" class="primary">Add Record</button></div>
    </form>
  `;

  container.querySelectorAll(".remove-prev").forEach((btn) =>
    btn.addEventListener("click", async () => {
      db.previousEmployerIncomes = db.previousEmployerIncomes.filter((p) => p.id !== btn.dataset.id);
      await persist();
      onSaved();
    }),
  );

  document.getElementById("prev-employer-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    db.previousEmployerIncomes.push({
      id: newId("pei"),
      employeeId: employee.id,
      financialYearId: fy.id,
      employerName: String(fd.get("employerName")),
      periodFrom: String(fd.get("periodFrom")),
      periodTo: String(fd.get("periodTo")),
      grossSalary: num(fd.get("grossSalary")),
      taxableSalary: num(fd.get("taxableSalary")),
      exemptions: num(fd.get("exemptions")),
      deductions: num(fd.get("deductions")),
      tdsDeducted: num(fd.get("tdsDeducted")),
      pfDeducted: num(fd.get("pfDeducted")),
      notes: String(fd.get("notes") || "") || null,
      createdAt: new Date().toISOString(),
    });
    await persist();
    onSaved();
  });
}

// --- Regime Comparison -------------------------------------------------------
function renderRegimeComparisonTab(container, employee, fy) {
  const estimate = PayrollEngine.estimateRegimeComparison(db, employee.id, fy.id);
  if (!estimate) {
    container.innerHTML = `<div class="card text-muted">No active salary structure for FY ${fy.code} yet - add one under the Salary Structure tab to see a regime comparison.</div>`;
    return;
  }
  const beneficial = estimate.old.totalTaxLiability <= estimate.new.totalTaxLiability ? "OLD" : "NEW";
  function col(label, r) {
    return `
      <div class="card">
        <div class="row between"><h3>${label}</h3>${beneficial === label.split(" ")[0].toUpperCase() ? '<span class="badge good">Beneficial</span>' : ""}</div>
        <table>
          <tbody>
            <tr><td>Taxable Income</td><td>${rupees(r.taxableIncome)}</td></tr>
            <tr><td>Tax before rebate</td><td>${rupees(r.taxBeforeRebate)}</td></tr>
            <tr><td>Rebate (87A)</td><td>${rupees(r.rebate)}</td></tr>
            <tr><td>Surcharge</td><td>${rupees(r.surcharge)}</td></tr>
            <tr><td>Cess</td><td>${rupees(r.cess)}</td></tr>
            <tr><td><strong>Total Tax Liability</strong></td><td><strong>${rupees(r.totalTaxLiability)}</strong></td></tr>
          </tbody>
        </table>
        ${r.warnings.length ? `<div class="text-muted mt-16" style="font-size:12px;">${r.warnings.map((w) => `<div>&#9888; ${escapeHtml(w)}</div>`).join("")}</div>` : ""}
      </div>
    `;
  }
  container.innerHTML = `
    <div class="card">
      <p>Estimated annual gross salary: <strong>${rupees(estimate.annualGross)}</strong>. Based on the current active Salary Structure and Investment Declaration for FY ${fy.code}, projected for the full year.</p>
      ${!estimate.hasDeclaration ? `<p class="text-bad">No Investment Declaration is on file yet - Old Regime figures assume zero Chapter VI-A deductions/HRA rent.</p>` : ""}
    </div>
    <div class="card-grid">
      ${col("OLD Regime", estimate.old)}
      ${col("NEW Regime", estimate.new)}
    </div>
  `;
}
