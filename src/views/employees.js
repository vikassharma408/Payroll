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
  if (action === "form16") return renderForm16(container, employee);
  renderEmployeeDetail(container, employee, action);
});

function renderEmployeesList(container) {
  if (!activeCompany()) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  let search = "";
  let selected = new Set();

  function render() {
    const viewCompanyIds = filteredCompanyIds();
    const showCompanyColumn = viewCompanyIds.length > 1;
    const companyEmployees = db.employees.filter((e) => viewCompanyIds.includes(e.companyId)).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
    const q = search.trim().toLowerCase();
    const filtered = q
      ? companyEmployees.filter((e) => [e.employeeCode, e.fullName, e.department, e.designation].some((v) => (v || "").toLowerCase().includes(q)))
      : companyEmployees;
    // Drop selections that fell out of the current filtered set, so the bulk bar's count stays accurate.
    selected = new Set([...selected].filter((id) => filtered.some((e) => e.id === id)));
    const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
    const rows = filtered
      .map(
        (e) => `
        <tr>
          <td><input type="checkbox" class="row-select" data-id="${e.id}" ${selected.has(e.id) ? "checked" : ""} /></td>
          <td><a href="#/employees/${e.id}">${escapeHtml(e.employeeCode)}</a></td>
          <td><a href="#/employees/${e.id}">${escapeHtml(e.fullName)}</a></td>
          ${showCompanyColumn ? `<td>${escapeHtml((db.companies.find((c) => c.id === e.companyId) || {}).name || "-")}</td>` : ""}
          <td>${escapeHtml(e.designation || "-")}</td>
          <td>${escapeHtml(e.department || "-")}</td>
          <td>${sentenceCase(e.taxRegime)}</td>
          <td><span class="badge ${e.status === "ACTIVE" ? "good" : e.status === "LEFT" ? "bad" : "neutral"}">${sentenceCase(e.status)}</span></td>
        </tr>`,
      )
      .join("");
    container.innerHTML = `
      <div class="row between mt-16" style="margin-bottom:16px;">
        <span class="text-muted">${escapeHtml(companyFilterLabel())}: ${filtered.length} of ${companyEmployees.length} employee(s)</span>
        <a href="#/employees/new"><button class="primary">+ Add Employee</button></a>
      </div>
      ${
        selected.size > 0
          ? `<div class="card" style="background:var(--ink);">
              <div class="row between" style="margin-bottom:4px;"><strong>${selected.size} selected</strong><button id="btn-clear-selection">Clear</button></div>
              <div class="row gap-8 mt-16">
                <input id="bulk-payroll-group" placeholder="Payroll group" style="max-width:200px;" />
                <button id="btn-bulk-group">Set Payroll Group</button>
                <select id="bulk-status" style="max-width:160px;">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="LEFT">Left</option>
                </select>
                <button id="btn-bulk-status">Set Status</button>
              </div>
            </div>`
          : ""
      }
      <div class="card">
        <input type="search" id="employee-search" placeholder="Search by code, name, department, or designation..." value="${escapeHtml(search)}" style="width:100%; margin-bottom:12px;" />
        <table>
          <thead><tr><th><input type="checkbox" id="select-all" ${allSelected ? "checked" : ""} /></th><th>Code</th><th>Name</th>${showCompanyColumn ? "<th>Company</th>" : ""}<th>Designation</th><th>Department</th><th>Regime</th><th>Status</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="${showCompanyColumn ? 8 : 7}" class="text-muted">${companyEmployees.length === 0 ? "No employees yet." : "No employees match your search."}</td></tr>`}</tbody>
        </table>
      </div>
    `;
    const searchInput = document.getElementById("employee-search");
    searchInput.addEventListener("input", (e) => {
      search = e.target.value;
      render();
      document.getElementById("employee-search").focus();
      document.getElementById("employee-search").setSelectionRange(search.length, search.length);
    });

    document.getElementById("select-all").addEventListener("change", (e) => {
      if (e.target.checked) filtered.forEach((emp) => selected.add(emp.id));
      else filtered.forEach((emp) => selected.delete(emp.id));
      render();
    });
    container.querySelectorAll(".row-select").forEach((cb) =>
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selected.add(cb.dataset.id);
        else selected.delete(cb.dataset.id);
        render();
      }),
    );
    const clearBtn = document.getElementById("btn-clear-selection");
    if (clearBtn) clearBtn.addEventListener("click", () => { selected.clear(); render(); });

    const bulkGroupBtn = document.getElementById("btn-bulk-group");
    if (bulkGroupBtn) {
      bulkGroupBtn.addEventListener("click", async () => {
        const value = String(document.getElementById("bulk-payroll-group").value || "").trim() || null;
        for (const id of selected) {
          const emp = db.employees.find((e) => e.id === id);
          if (emp) emp.payrollGroup = value;
        }
        logAudit("Employee", null, "BULK_UPDATE", `Set payroll group "${value || "(none)"}" for ${selected.size} employee(s)`);
        await persist();
        selected.clear();
        render();
      });
    }
    const bulkStatusBtn = document.getElementById("btn-bulk-status");
    if (bulkStatusBtn) {
      bulkStatusBtn.addEventListener("click", async () => {
        const value = document.getElementById("bulk-status").value;
        for (const id of selected) {
          const emp = db.employees.find((e) => e.id === id);
          if (emp) emp.status = value;
        }
        logAudit("Employee", null, "BULK_UPDATE", `Set status "${value}" for ${selected.size} employee(s)`);
        await persist();
        selected.clear();
        render();
      });
    }
  }

  render();
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
    state: "",
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
        <div><label>State (for Professional Tax)</label>
          <select name="state">
            <option value="" ${!e.state ? "selected" : ""}>- Use fixed PT from Salary Structure -</option>
            ${db.ptSlabs.map((s) => `<option value="${s.key}" ${e.state === s.key ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>
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
        <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" id="field-ptApplicable" name="ptApplicable" ${e.ptApplicable ? "checked" : ""} style="width:auto;" /> PT Applicable</label>
      </div>
      <p class="text-muted" style="font-size:12px;margin-top:6px;">PF/ESI/PT Applicable are overrides, not auto-detected: even if the Salary Structure has a PF, ESI or PT line, unticking the matching box here skips it for this employee only (e.g. above the PF wage ceiling, no ESI cover, or PT-exempt) - handy once Salary Structure Templates mean most employees share one standard structure. Ticking "PT Applicable" with a State selected switches PT to that state's auto-calculated slab (overriding any fixed PT figure in the Salary Structure); it's auto-ticked when you pick a State below, untick it if you'd rather keep a fixed manually-entered PT amount instead.</p>
      <div id="form-error" class="text-bad mt-16"></div>
      <div class="row gap-8 mt-16">
        <button type="submit" class="primary">${isEdit ? "Save Changes" : "Add Employee"}</button>
        <a href="#/${isEdit ? "employees/" + employee.id : "employees"}"><button type="button">Cancel</button></a>
      </div>
    </form>
  `;

  document.querySelector('select[name="state"]').addEventListener("change", (evt) => {
    document.getElementById("field-ptApplicable").checked = !!evt.target.value;
  });

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
      state: String(fd.get("state") || "") || null,
      costCentre: String(fd.get("costCentre") || "") || null,
      payrollGroup: String(fd.get("payrollGroup") || "") || null,
      uan: String(fd.get("uan") || "") || null,
      pfApplicable: fd.get("pfApplicable") === "on",
      esiApplicable: fd.get("esiApplicable") === "on",
      ptApplicable: fd.get("ptApplicable") === "on",
      taxRegime: String(fd.get("taxRegime") || "NEW"),
      status: String(fd.get("status") || "ACTIVE"),
      bankName: String(fd.get("bankName") || "") || null,
      bankAccountNo: String(fd.get("bankAccountNo") || "") || null,
      bankIfsc: bankIfsc || null,
    };

    let targetId;
    if (isEdit) {
      Object.assign(employee, data);
      targetId = employee.id;
      logAudit("Employee", targetId, "UPDATE", `Updated ${data.fullName} (${data.employeeCode})`);
    } else {
      const newEmployee = { id: newId("emp"), companyId, ageCategory: "BELOW_60", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data };
      db.employees.push(newEmployee);
      targetId = newEmployee.id;
      logAudit("Employee", targetId, "CREATE", `Created ${data.fullName} (${data.employeeCode})`);
    }
    await persist();
    navigate(`employees/${targetId}`);
  });
}

function renderEmployeeDetail(container, employee, initialTab) {
  const TAB_KEYS = ["profile", "salary", "investment", "previous-employer", "perquisites", "regime", "fnf"];
  let activeTab = TAB_KEYS.includes(initialTab) ? initialTab : "profile";
  const TABS = [
    ["profile", "Profile"],
    ["salary", "Salary Structure"],
    ["investment", "Investment Declaration"],
    ["previous-employer", "Previous Employer"],
    ["perquisites", "Perquisites"],
    ["regime", "Regime Comparison"],
    ...(employee.dateOfLeaving ? [["fnf", "Full & Final Settlement"]] : []),
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
          `Cannot delete ${employee.fullName} (${employee.employeeCode}): payroll has already been processed for them (FY ${fyCode}, month ${processedLine.run.payrollMonthIndex}, status ${processedLine.run.status.toLowerCase()}). Payroll history must be preserved. Set their status to Inactive or Left instead of deleting them.`,
        );
        return;
      }
      if (!confirm(`Delete ${employee.fullName}? This also removes their salary structure, investment declaration and previous employer records. This cannot be undone.`)) return;
      db.investmentDeclarations = db.investmentDeclarations.filter((d) => d.employeeId !== employee.id);
      db.previousEmployerIncomes = db.previousEmployerIncomes.filter((p) => p.employeeId !== employee.id);
      db.employeeSalaryStructures = db.employeeSalaryStructures.filter((s) => s.employeeId !== employee.id);
      db.employees = db.employees.filter((e) => e.id !== employee.id);
      logAudit("Employee", employee.id, "DELETE", `Deleted ${employee.fullName} (${employee.employeeCode})`);
      await persist();
      navigate("employees");
    });

    const tabContent = document.getElementById("tab-content");
    if (!fy) return;
    if (activeTab === "profile") renderProfileTab(tabContent, employee);
    else if (activeTab === "salary") renderSalaryStructureTab(tabContent, employee, fy, render);
    else if (activeTab === "investment") renderInvestmentDeclarationTab(tabContent, employee, fy, render);
    else if (activeTab === "previous-employer") renderPreviousEmployerTab(tabContent, employee, fy, render);
    else if (activeTab === "perquisites") renderPerquisitesTab(tabContent, employee, fy, render);
    else if (activeTab === "regime") renderRegimeComparisonTab(tabContent, employee, fy, render);
    else if (activeTab === "fnf") renderFnfTab(tabContent, employee, fy, render);
  }

  render();
}

function renderProfileTab(container, e) {
  const field = (label, value) => `<div><div class="stat-label">${label}</div><div>${value || '<span class="text-muted">-</span>'}</div></div>`;
  container.innerHTML = `
    <div class="card card-grid">
      ${field("Date of Birth", e.dob)}
      ${field("Gender", sentenceCase(e.gender))}
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
      ${field("Bank", e.bankName ? `${e.bankName} · ${e.bankAccountNo || ""} · ${e.bankIfsc || ""}` : "")}
    </div>
  `;
}

// --- Salary Structure ------------------------------------------------------
function renderSalaryStructureTab(container, employee, fy, onSaved) {
  const active = db.employeeSalaryStructures
    .filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];

  // You enter each component's MONTHLY amount directly (matching how most
  // payroll admins already think, and the source spreadsheet this app was
  // built from); annual CTC is a read-only total computed from these, not a
  // separate input - so there's nothing to keep in sync by hand.
  let rows = active ? active.components.map((c) => ({ componentId: c.componentId, componentCode: c.componentCode, monthlyAmount: c.monthlyAmount })) : [];
  let effectiveFromInput = new Date().toISOString().slice(0, 10);
  let targetRunId = "";
  let selectedTemplateId = "";
  let targetCtcInput = "";

  function computedCtc() {
    return rows.reduce((s, r) => {
      const comp = db.salaryComponents.find((c) => c.id === r.componentId);
      return comp && (comp.category === "EARNING" || comp.category === "EMPLOYER_CONTRIBUTION") ? s + r.monthlyAmount * 12 : s;
    }, 0);
  }

  function render() {
    const options = db.salaryComponents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => `<option value="${c.id}">${c.code} - ${c.name} (${sentenceCase(c.category)})</option>`)
      .join("");

    const arrears = active ? PayrollEngine.computeArrears(db, employee.id, fy.id, active.effectiveFrom) : null;
    const companyTemplates = db.salaryStructureTemplates.filter((t) => t.companyId === employee.companyId);
    if (!selectedTemplateId && companyTemplates[0]) selectedTemplateId = companyTemplates[0].id;

    container.innerHTML = `
      ${
        companyTemplates.length === 0
          ? `<div class="card"><p class="text-muted">No Salary Structure Templates set up for this company yet. <a href="#/salary-templates/new">Create one</a> to generate a full breakup from just a CTC figure next time.</p></div>`
          : `<div class="card">
        <h3>Generate From Template</h3>
        <p class="text-muted" style="font-size:12px;">Pick a company template and enter this employee's target annual CTC - it fills in every component's monthly and annual amount below, which you can still tweak by hand afterwards.</p>
        <div class="row gap-8" style="align-items:flex-end;">
          <div><label>Template</label><select id="gen-template-select">${companyTemplates.map((t) => `<option value="${t.id}" ${t.id === selectedTemplateId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select></div>
          <div><label>Target Annual CTC</label><input type="number" min="0" id="gen-target-ctc" value="${targetCtcInput}" placeholder="e.g. 1200000" /></div>
          <button id="btn-generate-structure">Generate Structure</button>
          <a href="#/salary-templates" style="margin-left:auto;">Manage Templates</a>
        </div>
        <div id="generate-error" class="text-bad mt-16"></div>
        <div id="generate-note" class="text-muted mt-16" style="font-size:12px;"></div>
      </div>`
      }
      <div class="card">
        <div class="row gap-8" style="align-items:flex-end;">
          <div><div class="stat-label">Annual CTC (computed)</div><div class="stat-value" id="ctc-display">${rupees(computedCtc())}</div></div>
          <div style="margin-left:auto;"><label>Effective From</label><input type="date" id="structure-effective-from" value="${effectiveFromInput}" /></div>
        </div>
        <p class="text-muted" style="font-size:12px;">Sum of all Earning + Employer Contribution components below, x12. Enter each component's MONTHLY amount; this total updates automatically. Backdate "Effective From" for a mid-year revision (e.g. revising in June, effective from April) - any already-paid months in between will show up below as Arrears due.</p>
        <table class="mt-16">
          <thead><tr><th>Component</th><th>Category</th><th>Monthly Amount</th><th>Annual</th><th></th></tr></thead>
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
      ${renderArrearsPanel(arrears)}
      ${
        db.employeeSalaryStructures.filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id).length > 1
          ? `<div class="card"><h3>Structure History</h3>${renderStructureHistory()}</div>`
          : ""
      }
    `;
    renderRows();
    document.getElementById("structure-effective-from").addEventListener("change", (e) => {
      effectiveFromInput = e.target.value;
    });
    wireArrearsPanel(arrears);
    const genTemplateSelect = document.getElementById("gen-template-select");
    if (genTemplateSelect) {
      genTemplateSelect.addEventListener("change", (e) => { selectedTemplateId = e.target.value; });
      document.getElementById("gen-target-ctc").addEventListener("input", (e) => { targetCtcInput = e.target.value; });
      document.getElementById("btn-generate-structure").addEventListener("click", () => {
        const errorEl = document.getElementById("generate-error");
        const noteEl = document.getElementById("generate-note");
        errorEl.textContent = "";
        noteEl.textContent = "";
        const ctc = num(targetCtcInput);
        try {
          const result = PayrollEngine.generateStructureFromTemplate(db, selectedTemplateId, ctc);
          const generatedRows = result.components.filter((c) => c.componentId).map((c) => ({ componentId: c.componentId, componentCode: c.componentCode, monthlyAmount: c.monthlyAmount, formulaUsed: c.formulaTrace }));
          if (generatedRows.length < result.components.length) {
            errorEl.textContent = "Some template rows reference a salary component that no longer exists and were skipped.";
          }
          rows = generatedRows;
          renderRows();
          document.getElementById("ctc-display").textContent = rupees(computedCtc());
          noteEl.textContent = result.includeGratuityInCTC || result.totalCostToCompany === result.annualCTC
            ? `Generated from "${result.templateName}" for CTC ${rupees(result.annualCTC)}.`
            : `Generated from "${result.templateName}" for CTC ${rupees(result.annualCTC)}. Gratuity is kept outside this CTC figure, so total cost to company incl. Gratuity is ${rupees(result.totalCostToCompany)}.`;
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }
    document.getElementById("btn-add-row").addEventListener("click", () => {
      const select = document.getElementById("add-component-select");
      const comp = db.salaryComponents.find((c) => c.id === select.value);
      if (!comp || rows.some((r) => r.componentId === comp.id)) return;
      rows.push({ componentId: comp.id, componentCode: comp.code, monthlyAmount: 0 });
      renderRows();
    });
    document.getElementById("btn-save-structure").addEventListener("click", async () => {
      const errorEl = document.getElementById("structure-error");
      errorEl.textContent = "";
      if (rows.length === 0) {
        errorEl.textContent = "Add at least one salary component.";
        return;
      }
      if (!effectiveFromInput) {
        errorEl.textContent = "Set an Effective From date.";
        return;
      }
      const now = new Date().toISOString();
      const newEffectiveFrom = new Date(effectiveFromInput).toISOString();
      const previouslyActive = db.employeeSalaryStructures.find((s) => s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive);
      if (previouslyActive && new Date(newEffectiveFrom) < new Date(previouslyActive.effectiveFrom)) {
        errorEl.textContent = `Effective From can't be before the current structure's own Effective From (${previouslyActive.effectiveFrom.slice(0, 10)}). To correct an even earlier period, edit the Structure History records directly.`;
        return;
      }
      if (previouslyActive) {
        previouslyActive.isActive = false;
        previouslyActive.effectiveTo = new Date(new Date(newEffectiveFrom).getTime() - 86400000).toISOString();
      }
      const structure = {
        id: newId("ess"),
        employeeId: employee.id,
        financialYearId: fy.id,
        annualCTC: computedCtc(),
        effectiveFrom: newEffectiveFrom,
        effectiveTo: null,
        isActive: true,
        createdAt: now,
        components: rows.map((r) => {
          const comp = db.salaryComponents.find((c) => c.id === r.componentId);
          return {
            componentId: r.componentId,
            componentCode: r.componentCode,
            category: comp.category,
            monthlyAmount: r.monthlyAmount,
            annualAmount: r.monthlyAmount * 12,
            formulaUsed: r.formulaUsed || `Entered as fixed monthly amount: Rs ${r.monthlyAmount.toLocaleString("en-IN")}/month`,
          };
        }),
      };
      db.employeeSalaryStructures.push(structure);
      logAudit("EmployeeSalaryStructure", structure.id, "CREATE", `New salary structure for ${employee.fullName} (${employee.employeeCode}), CTC ${rupees(structure.annualCTC)}`);
      await persist();
      onSaved();
    });
  }

  /** Eligible runs to receive an arrears payment: still open (not LOCKED/PAID), this employee's company+FY, and the employee is actually eligible for that run (payroll group, employment dates). */
  function eligibleArrearsRuns() {
    return db.payrollRuns
      .filter((r) => r.companyId === employee.companyId && r.financialYearId === fy.id && r.status !== "LOCKED" && r.status !== "PAID" && PayrollEngine.isEmployeeEligibleForRun(employee, r))
      .sort((a, b) => a.payrollMonthIndex - b.payrollMonthIndex);
  }

  function renderArrearsPanel(arrears) {
    if (!arrears || (arrears.months.length === 0 && arrears.reprocessableRunIds.length === 0)) return "";
    const runs = eligibleArrearsRuns();
    if (!targetRunId || !runs.some((r) => r.id === targetRunId)) targetRunId = runs[0] ? runs[0].id : "";
    const reprocessNote =
      arrears.reprocessableRunIds.length > 0
        ? `<p class="text-muted" style="font-size:12px;">${arrears.reprocessableRunIds.length} already-processed run(s) in this gap are still open - they'll pick up this structure automatically next time they're recalculated, so no arrears needed for those.</p>`
        : "";
    if (arrears.months.length === 0) {
      return `<div class="card">${reprocessNote}</div>`;
    }
    const rows = arrears.months
      .map(
        (m) => `
        <tr>
          <td>${FY_MONTH_NAMES[m.payrollMonthIndex - 1]} ${m.calendarYear}</td>
          <td>${rupees(m.previousGross)}</td>
          <td>${rupees(m.revisedGross)}</td>
          <td class="${m.diff >= 0 ? "text-good" : "text-bad"}">${rupees(m.diff)}</td>
        </tr>`,
      )
      .join("");
    return `
      <div class="card">
        <h3>Arrears Due</h3>
        <p class="text-muted" style="font-size:12px;">These months were already paid (and locked/paid) under the superseded structure. The difference below is owed as Arrears, taxed in whichever run you apply it to - not retroactively re-taxed in the original month.</p>
        <table class="mt-16">
          <thead><tr><th>Month</th><th>Previously Paid (Gross)</th><th>Now Due (Gross)</th><th>Difference</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="row between mt-16"><strong>Total Arrears</strong><strong>${rupees(arrears.total)}</strong></div>
        ${reprocessNote}
        <div class="row gap-8 mt-16" style="align-items:flex-end;">
          <div><label>Apply To Run</label>
            <select id="arrears-target-run">${runs.map((r) => `<option value="${r.id}" ${r.id === targetRunId ? "selected" : ""}>${monthLabel(r)}${r.payrollGroup ? " - " + r.payrollGroup : ""}</option>`).join("") || `<option value="">No open run available</option>`}</select>
          </div>
          <button class="primary" id="btn-apply-arrears" ${runs.length === 0 ? "disabled" : ""}>Add ${rupees(arrears.total)} as Arrears to Selected Run</button>
        </div>
        <div id="arrears-error" class="text-bad mt-16"></div>
      </div>
    `;
  }

  function wireArrearsPanel(arrears) {
    const runSelect = document.getElementById("arrears-target-run");
    if (runSelect) runSelect.addEventListener("change", (e) => { targetRunId = e.target.value; });
    const applyBtn = document.getElementById("btn-apply-arrears");
    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        const errorEl = document.getElementById("arrears-error");
        errorEl.textContent = "";
        try {
          PayrollEngine.applyArrears(db, employee.id, targetRunId, arrears);
          const run = db.payrollRuns.find((r) => r.id === targetRunId);
          logAudit("PayrollRun", targetRunId, "ARREARS_APPLIED", `${rupees(arrears.total)} arrears for ${employee.fullName} (${employee.employeeCode}), covering ${arrears.months.length} month(s), applied to ${monthLabel(run)}`);
          await persist();
          render();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }
  }

  function renderRows() {
    const tbody = document.getElementById("rows-body");
    tbody.innerHTML = rows
      .map((r, i) => {
        const comp = db.salaryComponents.find((c) => c.id === r.componentId);
        return `
        <tr>
          <td>${comp.code} - ${comp.name}</td>
          <td>${sentenceCase(comp.category)}</td>
          <td><input data-idx="${i}" type="number" min="0" class="monthly-input" value="${r.monthlyAmount}" /></td>
          <td>${rupees(r.monthlyAmount * 12)}</td>
          <td><button data-idx="${i}" class="danger remove-row">Remove</button></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".monthly-input").forEach((el) =>
      el.addEventListener("input", (e) => {
        const row = rows[Number(e.target.dataset.idx)];
        row.monthlyAmount = num(e.target.value);
        row.formulaUsed = null;
        renderRows();
        document.getElementById("ctc-display").textContent = rupees(computedCtc());
      }),
    );
    tbody.querySelectorAll(".remove-row").forEach((el) =>
      el.addEventListener("click", (e) => {
        rows.splice(Number(e.target.dataset.idx), 1);
        renderRows();
        document.getElementById("ctc-display").textContent = rupees(computedCtc());
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
  ["Sec 123 basket (old 80C / 80CCC / 80CCD(1))", [
    ["lic", "LIC Premium"], ["epf", "EPF (voluntary)"], ["ppf", "PPF"], ["elss", "ELSS"],
    ["lifeInsurance", "Life Insurance"], ["tuitionFees", "Tuition Fees"], ["housingLoanPrincipal", "Housing Loan Principal"],
    ["otherSection80C", "Other (old 80C)"], ["section80CCC", "Pension Fund (old 80CCC)"], ["section80CCD1", "NPS Employee (old 80CCD(1))"],
  ]],
  ["Sec 124 - Additional NPS (old 80CCD(1B))", [["section80CCD1B", "Additional NPS"]]],
  ["Sec 126 - Medical Insurance (old 80D)", [
    ["section80DSelfBelow60", "Self/Family (below 60)"], ["section80DParentsBelow60", "Parents (below 60)"],
    ["section80DSelfAbove60", "Self/Family (60+)"], ["section80DParentsAbove60", "Parents (60+)"],
  ]],
  ["Other Deductions", [
    ["section80E", "Education Loan Interest (Sec 129, old 80E)"], ["section80EE", "Home Loan Interest (Sec 130, old 80EE)"], ["section80EEA", "Home Loan Interest (Sec 131, old 80EEA)"],
    ["section80UBelow80", "Self Disability <80% (Sec 154, old 80U)"], ["section80U80AndAbove", "Self Disability 80%+ (Sec 154, old 80U)"],
    ["section80DDBelow80", "Dependent Disability <80% (Sec 127, old 80DD)"], ["section80DD80AndAbove", "Dependent Disability 80%+ (Sec 127, old 80DD)"],
    ["donations80G", "Donations (Sec 133, old 80G)"], ["otherDeductions", "Other Deductions"], ["ltaClaimed", "LTA Exempt Amount (old Sec 10(5))"],
  ]],
  ["House Property", [
    ["homeLoanInterestSelfOccupied", "Home Loan Interest (Self-Occupied, Sec 24(b))"],
    ["letOutAnnualValue", "Let-Out: Annual Value"], ["letOutMunicipalTax", "Let-Out: Municipal Tax"], ["letOutHomeLoanInterest", "Let-Out: Home Loan Interest"],
  ]],
];

// Maximum deduction/exemption each field is capped at (old regime only) -
// the app itself always applies these caps when computing tax (see
// DEDUCTION_LIMITS in rule-configs.js and tax-engine.js), so entering more
// than the limit is harmless - it's just shown here so the figures entered
// can be sanity-checked against what the law actually allows. Rupee limits
// re-verified against current sources as of October 2026 - all unchanged
// from the old Act. Section citations use the Income-tax Act, 2025
// numbering (effective 1 April 2026 / Tax Year 2026-27), with the familiar
// old Sec 80C/80D/etc. numbering in brackets; left uncited where research
// couldn't confirm a specific new number (see rule-configs.js's header
// comment for the full citation list and confidence notes).
const DEDUCTION_LIMIT_REFERENCE = [
  ["LIC / EPF / PPF / ELSS / Life Insurance / Tuition Fees / Housing Loan Principal / 80CCC / 80CCD(1) (combined) - Sec 123", "Rs 1,50,000 total"],
  ["80CCD(1B) Additional NPS - Sec 124", "Rs 50,000 (on top of the Rs 1,50,000 above - Rs 2,00,000 combined ceiling)"],
  ["80D Self/Family (below 60) - Sec 126", "Rs 25,000 (includes up to Rs 5,000 for preventive health checkup, not in addition)"],
  ["80D Self/Family (60+) - Sec 126", "Rs 50,000 (includes up to Rs 5,000 for preventive health checkup, not in addition)"],
  ["80D Parents (below 60) - Sec 126", "Rs 25,000"],
  ["80D Parents (60+) - Sec 126", "Rs 50,000"],
  ["80DD Dependent Disability (<80%) - Sec 127 / 80U Self Disability (<80%) - Sec 154", "Rs 75,000 (each)"],
  ["80DD Dependent Disability (80%+) - Sec 127 / 80U Self Disability (80%+) - Sec 154", "Rs 1,25,000 (each)"],
  ["80E Education Loan Interest - Sec 129", "No upper limit - full interest amount, for 8 years from first repayment"],
  ["80EE Home Loan Interest (additional, first-time buyers) - Sec 130", "Rs 50,000"],
  ["80EEA Home Loan Interest (affordable housing) - Sec 131", "Rs 1,50,000 - only for loans sanctioned 1 Apr 2019 to 31 Mar 2022"],
  ["80G Donations - Sec 133", "50% or 100% of the donated amount depending on the institution, some subject to a 10%-of-income qualifying limit - enter the employee's own already-computed eligible amount"],
  ["LTA Exempt Amount - old Sec 10(5) (new Act number not independently verified)", "Limited to actual eligible travel cost incurred, for 2 journeys in a block of 4 calendar years (current block: 2026-2029) - not a flat rupee cap"],
  ["Home Loan Interest (Self-Occupied) - Sec 24(b)", "Rs 2,00,000"],
  ["House Property Loss Set-Off (self-occupied + let-out combined) - old Sec 71(3A) (new Act number not independently verified)", "Rs 2,00,000 against other income per year; any excess carries forward (not tracked by this app)"],
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
    <div class="card">
      <details>
        <summary><strong>Deduction &amp; Exemption Limits (reference - old regime only)</strong></summary>
        <table class="mt-16">
          <thead><tr><th>Head</th><th>Maximum</th></tr></thead>
          <tbody>${DEDUCTION_LIMIT_REFERENCE.map(([head, limit]) => `<tr><td>${escapeHtml(head)}</td><td>${escapeHtml(limit)}</td></tr>`).join("")}</tbody>
        </table>
      </details>
    </div>
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
        <label class="row gap-8 mt-16" style="display:flex;align-items:center;">
          <input type="checkbox" name="isMetroCity" ${d.isMetroCity ? "checked" : ""} style="width:auto;" /> Metro City (Delhi / Mumbai / Kolkata / Chennai)
        </label>
        <p class="text-muted mt-16" style="font-size:12px;">Leave Start/End Date blank if rent was paid for the entire financial year. If set, HRA exemption is only calculated for the months within this period (e.g. if rent started in July, April-June get no HRA exemption). Metro City raises the HRA exemption limit to 50% of Basic (40% for non-metro) - re-declare it here each financial year if the employee's base location changes.</p>
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
    record.isMetroCity = fd.get("isMetroCity") === "on";
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

// --- Perquisites -------------------------------------------------------------
function renderPerquisitesTab(container, employee, fy, onSaved) {
  const entries = db.employeePerquisites.filter((p) => p.employeeId === employee.id && p.financialYearId === fy.id);
  const { total, breakdown, rates } = computePerquisitesTotal(entries, fy.startDate);
  let type = "GIFT_VOUCHER";

  function render() {
    container.innerHTML = `
      <div class="card">
        <div class="stat-label">Total Taxable Perquisite Value (FY ${fy.code})</div>
        <div class="stat-value">${rupees(total)}</div>
        <div class="text-muted" style="font-size:12px; margin-top:4px;">Valued per ${escapeHtml(rates.label)}.</div>
      </div>
      <div class="card">
        <h3>Declared Perquisites</h3>
        <table>
          <thead><tr><th>Type</th><th>Details</th><th>Taxable Value</th><th></th></tr></thead>
          <tbody>
            ${
              breakdown
                .map((b) => `<tr><td>${PERQUISITE_TYPES.find((t) => t.key === b.type)?.label || b.type}</td><td>${escapeHtml(b.label)}<div class="text-muted" style="font-size:12px;">${escapeHtml(b.note)}</div></td><td>${rupees(b.taxableValue)}</td><td>${b.id ? `<button class="danger remove-perq" data-id="${b.id}">Remove</button>` : ""}</td></tr>`)
                .join("") || `<tr><td colspan="4" class="text-muted">No perquisites declared for FY ${fy.code}.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <form id="perquisite-form" class="card">
        <h3>Add Perquisite</h3>
        <div class="form-grid">
          <div><label>Type</label>
            <select id="perq-type-select">${PERQUISITE_TYPES.map((t) => `<option value="${t.key}" ${t.key === type ? "selected" : ""}>${t.label}</option>`).join("")}</select>
          </div>
        </div>
        <div id="perq-type-fields" class="mt-16"></div>
        <div id="perq-form-error" class="text-bad mt-16"></div>
        <div class="row gap-8 mt-16"><button type="submit" class="primary">Add</button></div>
      </form>
    `;
    renderTypeFields();
    document.getElementById("perq-type-select").addEventListener("change", (e) => {
      type = e.target.value;
      renderTypeFields();
    });
    container.querySelectorAll(".remove-perq").forEach((btn) =>
      btn.addEventListener("click", async () => {
        db.employeePerquisites = db.employeePerquisites.filter((p) => p.id !== btn.dataset.id);
        await persist();
        onSaved();
      }),
    );
    document.getElementById("perquisite-form").addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const fd = new FormData(evt.target);
      const errorEl = document.getElementById("perq-form-error");
      let entry = { id: newId("perq"), employeeId: employee.id, financialYearId: fy.id, type, createdAt: new Date().toISOString() };
      if (type === "GIFT_VOUCHER") {
        const amount = num(fd.get("amount"));
        if (amount <= 0) {
          errorEl.textContent = "Enter the gift/voucher value.";
          return;
        }
        entry.amount = amount;
        entry.description = String(fd.get("description") || "") || null;
      } else if (type === "CAR") {
        entry.usageType = String(fd.get("usageType") || "PARTLY_PERSONAL");
        entry.engineCategory = String(fd.get("engineCategory") || "UPTO_1600CC");
        entry.hasDriver = fd.get("hasDriver") === "on";
        entry.monthsUsed = num(fd.get("monthsUsed")) || 12;
        entry.runningMaintenanceCost = num(fd.get("runningMaintenanceCost"));
        entry.driverSalary = num(fd.get("driverSalary"));
        entry.depreciationBase = num(fd.get("depreciationBase"));
        entry.recoveredFromEmployee = num(fd.get("recoveredFromEmployee"));
        entry.description = String(fd.get("description") || "") || null;
      } else {
        const taxableValue = num(fd.get("taxableValue"));
        if (!String(fd.get("label") || "").trim()) {
          errorEl.textContent = "Enter a label for this perquisite.";
          return;
        }
        entry.label = String(fd.get("label"));
        entry.taxableValue = taxableValue;
        entry.note = String(fd.get("note") || "") || null;
      }
      db.employeePerquisites.push(entry);
      await persist();
      onSaved();
    });
  }

  function renderTypeFields() {
    const el = document.getElementById("perq-type-fields");
    if (type === "GIFT_VOUCHER") {
      el.innerHTML = `
        <p class="text-muted" style="font-size:12px;">Gifts/vouchers are exempt up to Rs ${rates.giftExemptionThreshold.toLocaleString("en-IN")} in aggregate per year (${escapeHtml(rates.ruleRef)}) - if the YEAR'S TOTAL across all gifts exceeds that, the full amount becomes taxable, not just the excess. Add one entry per gift; the total is computed automatically.</p>
        <div class="form-grid">
          <div><label>Value *</label><input type="number" min="0" name="amount" required /></div>
          <div><label>Description</label><input name="description" placeholder="e.g. Diwali gift voucher" /></div>
        </div>
      `;
    } else if (type === "CAR") {
      el.innerHTML = `
        <div class="form-grid">
          <div><label>Description</label><input name="description" placeholder="e.g. Honda City, registration no." /></div>
          <div><label>Usage Type</label>
            <select name="usageType" id="car-usage-type">
              <option value="PARTLY_PERSONAL">Partly official, partly personal (most common)</option>
              <option value="OFFICIAL_ONLY">Wholly for official duties</option>
              <option value="WHOLLY_PERSONAL">Wholly for personal use</option>
            </select>
          </div>
          <div><label>Months Used This FY</label><input type="number" min="1" max="12" name="monthsUsed" value="12" /></div>
        </div>
        <div class="card" style="background:var(--ink); margin-top:12px;">
          <p class="text-muted" style="font-size:12px;">Used only for "Partly official, partly personal" (flat monthly rate per ${escapeHtml(rates.ruleRef)}):</p>
          <div class="form-grid">
            <div><label>Engine Capacity</label>
              <select name="engineCategory">
                <option value="UPTO_1600CC">Up to 1.6 litre (Rs ${rates.carFlatMonthlyRate.UPTO_1600CC}/month)</option>
                <option value="ABOVE_1600CC">Above 1.6 litre (Rs ${rates.carFlatMonthlyRate.ABOVE_1600CC}/month)</option>
              </select>
            </div>
            <div style="display:flex;align-items:flex-end;"><label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="hasDriver" style="width:auto;" /> Employer also provides a driver (+Rs ${rates.carDriverFlatMonthlyRate}/month)</label></div>
          </div>
        </div>
        <div class="card" style="background:var(--ink); margin-top:12px;">
          <p class="text-muted" style="font-size:12px;">Used only for "Wholly for personal use" (actual-cost method per ${escapeHtml(rates.ruleRef)}):</p>
          <div class="form-grid">
            <div><label>Running &amp; Maintenance Cost</label><input type="number" min="0" name="runningMaintenanceCost" value="0" /></div>
            <div><label>Driver Salary</label><input type="number" min="0" name="driverSalary" value="0" /></div>
            <div><label>Car Cost (for ${rates.carDepreciationRatePa * 100}%/year depreciation)</label><input type="number" min="0" name="depreciationBase" value="0" /></div>
            <div><label>Amount Recovered from Employee</label><input type="number" min="0" name="recoveredFromEmployee" value="0" /></div>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = `
        <p class="text-bad" style="font-size:12px;">This covers anything not modeled above (rent-free accommodation, ESOPs, interest-free loans, club membership, etc.) - work out the taxable value yourself per the applicable ${escapeHtml(rates.ruleRef)} provision (FY ${fy.code}) and enter it directly.</p>
        <div class="form-grid">
          <div><label>Label *</label><input name="label" placeholder="e.g. Club membership" required /></div>
          <div><label>Taxable Value *</label><input type="number" min="0" name="taxableValue" required /></div>
          <div><label>Note</label><input name="note" placeholder="Optional - how you worked this out" /></div>
        </div>
      `;
    }
  }

  render();
}

// --- Regime Comparison -------------------------------------------------------
/** Every row of the full side-by-side Old vs New computation table lives here, each naming how to pull its Old and New values out of the two calculateTax() results - see renderComputationTable() below. */
function buildComputationRows(estimate) {
  const oldR = estimate.old, newR = estimate.new;
  const step = (r, label) => {
    const found = r.steps.find((s) => s.label === label);
    return found ? found.amount : 0;
  };
  const stepOldOnly = (label) => ({ old: step(oldR, label), new: null });
  const stepBoth = (label) => ({ old: step(oldR, label), new: step(newR, label) });
  const chapter = (r, label) => {
    const found = r.chapterVIABreakdown.find((d) => d.label === label);
    return found ? found.allowed : 0;
  };
  const chapterOldOnly = (label) => ({ old: chapter(oldR, label), new: null });
  const chapterBoth = (label) => ({ old: chapter(oldR, label), new: chapter(newR, label) });
  const both = (val) => ({ old: val, new: val });

  const decl = estimate.declaration || {};
  const selfOccupiedInterest = decl.homeLoanInterestSelfOccupied || 0;
  const letOutAnnualValue = decl.letOutAnnualValue || 0;
  const letOutMunicipalTax = decl.letOutMunicipalTax || 0;
  const letOutNav = letOutAnnualValue - letOutMunicipalTax;
  const letOutStdDeduction = letOutNav * 0.3;
  const letOutInterest = decl.letOutHomeLoanInterest || 0;

  const perqRows = (estimate.perquisiteBreakdown || []).map((p) => ({ section: "perq", label: p.label, ...both(p.taxableValue) }));

  return [
    { section: "salary", label: "Gross Salary from current employer", ...stepBoth("Gross Salary (current employer)") },
    { section: "salary", label: "Income from Salary - previous employer", ...stepBoth("Add: Income from Salary - previous employer") },
    { section: "perq-header" },
    { section: "perq", label: "Employer contribution to NPS, PF and Superannuation fund in excess of Rs 7.50 lakhs", ...stepBoth("Employer PF+NPS+Superannuation perquisite u/s 17 (old Sec 17(2)(vii))") },
    { section: "perq", label: "Employer NPS Contribution (included in salary u/s 16, old Sec 17(1)(viii))", ...stepBoth("Employer NPS Contribution (included in salary u/s 16, old Sec 17(1)(viii))") },
    ...perqRows,
    { section: "total", label: "Total Salary", bold: true, ...stepBoth("Total Salary (before exemptions/deductions)") },
    { section: "spacer" },
    { section: "less", label: "Less: HRA Exemption (old Sec 10(13A))", ...stepOldOnly("Less: HRA Exemption (old Sec 10(13A) - now a new Act Schedule provision)") },
    { section: "less", label: "Less: LTA Exemption (old Sec 10(5))", ...stepOldOnly("Less: LTA Exemption (old Sec 10(5))") },
    { section: "less-header", label: "Less: Deduction u/s 16" },
    { section: "less", label: "Profession Tax u/s 16(iii)", ...stepOldOnly("Less: Profession Tax u/s 19 (old Sec 16(iii))") },
    { section: "less", label: "Standard Deduction u/s 16(ia)", ...stepBoth("Less: Standard Deduction u/s 19 (old Sec 16(ia))") },
    { section: "total", label: "Income from Salary", bold: true, ...stepBoth("Income from Salary") },
    { section: "spacer" },
    { section: "header", label: "Income from House Property (Self-Occupied)" },
    { section: "hp", label: "Net Annual Value", old: 0, new: null },
    { section: "hp", label: "Less: Standard deduction (30% of NAV)", old: 0, new: null },
    { section: "hp", label: "Less: Interest on Housing Loan", old: selfOccupiedInterest, new: null },
    { section: "total", label: "Income from House Property (Self-Occupied)", ...stepOldOnly("Income from House Property (Self-Occupied) - interest u/s 24(b) (unchanged)") },
    { section: "spacer" },
    { section: "header", label: "Income from House Property (Let-out)" },
    { section: "hp", label: "Annual Value", ...both(letOutAnnualValue) },
    { section: "hp", label: "Less: Municipal Tax Paid", ...both(letOutMunicipalTax) },
    { section: "hp", label: "Net Annual Value", ...both(letOutNav) },
    { section: "hp", label: "Less: Standard deduction (30% of NAV)", ...both(letOutStdDeduction) },
    { section: "hp", label: "Less: Interest on Housing Loan", ...both(letOutInterest) },
    { section: "total", label: "Income from House Property (Let-out)", ...stepBoth("Income from House Property (Let-out)") },
    { section: "spacer" },
    { section: "total", label: "Gross Total Income", bold: true, ...stepBoth("Gross Total Income") },
    { section: "spacer" },
    { section: "header", label: "Deductions Under Chapter VI-A" },
    { section: "vi-a", label: "Sec 124 (old 80CCD(2)) - Employer NPS", ...chapterBoth("Sec 124 (old 80CCD(2)) - Employer NPS Contribution") },
    { section: "vi-a", label: "Sec 123 (old 80C / 80CCC / 80CCD(1))", ...chapterOldOnly("Sec 123 (old 80C / 80CCC / 80CCD(1))") },
    { section: "vi-a", label: "Sec 124 (old 80CCD(1B)) - Additional NPS", ...chapterOldOnly("Sec 124 (old 80CCD(1B)) - Additional NPS") },
    { section: "vi-a", label: "Sec 126 (old 80D) - Medical Insurance", ...chapterOldOnly("Sec 126 (old 80D) - Medical Insurance") },
    { section: "vi-a", label: "Sec 127 (old 80DD) - Dependent Disability", ...chapterOldOnly("Sec 127 (old 80DD) - Dependent Disability") },
    { section: "vi-a", label: "Sec 129 (old 80E) - Education Loan Interest", ...chapterOldOnly("Sec 129 (old 80E) - Education Loan Interest") },
    { section: "vi-a", label: "Sec 130 (old 80EE) - Home Loan Interest", ...chapterOldOnly("Sec 130 (old 80EE) - Home Loan Interest (additional)") },
    { section: "vi-a", label: "Sec 131 (old 80EEA) - Home Loan Interest", ...chapterOldOnly("Sec 131 (old 80EEA) - Home Loan Interest (additional)") },
    { section: "vi-a", label: "Sec 133 (old 80G) - Donations", ...chapterOldOnly("Sec 133 (old 80G) - Donations") },
    { section: "vi-a", label: "Sec 154 (old 80U) - Self Disability", ...chapterOldOnly("Sec 154 (old 80U) - Self Disability") },
    { section: "vi-a", label: "Other Declared Deductions", ...chapterOldOnly("Other Declared Deductions") },
    { section: "total", label: "Total Deductions", bold: true, old: oldR.totalChapterVIADeductions, new: newR.totalChapterVIADeductions },
    { section: "spacer" },
    { section: "total", label: "Rounded off Net Taxable Income u/s 288A", bold: true, old: oldR.taxableIncome, new: newR.taxableIncome },
    { section: "spacer" },
    { section: "tax", label: "Tax", old: oldR.taxBeforeRebate, new: newR.taxBeforeRebate },
    { section: "tax", label: "Less: Rebate u/s 87A", old: -oldR.rebate, new: -newR.rebate },
    { section: "total", label: "Total Tax", bold: true, old: oldR.taxAfterRebate, new: newR.taxAfterRebate },
    { section: "tax", label: "Surcharge", old: oldR.surcharge, new: newR.surcharge },
    { section: "tax", label: "Health & Education Cess", old: oldR.cess, new: newR.cess },
    { section: "total", label: "Total Tax Liability", bold: true, old: oldR.totalTaxLiability, new: newR.totalTaxLiability },
  ];
}

function renderComputationTable(estimate) {
  const rows = buildComputationRows(estimate);
  const fmt = (v) => (v === null ? "NA" : !v ? "-" : rupees(v));
  const savings = estimate.old.totalTaxLiability - estimate.new.totalTaxLiability;
  const rowHtml = (r) => {
    if (r.section === "spacer") return `<tr><td colspan="3">&nbsp;</td></tr>`;
    if (r.section === "perq-header") return `<tr><td colspan="3"><em>Add : Perquisite u/s 17</em></td></tr>`;
    if (r.section === "less-header") return `<tr><td colspan="3"><em>${escapeHtml(r.label)}</em></td></tr>`;
    if (r.section === "header") return `<tr><td colspan="3"><strong>${escapeHtml(r.label)}</strong></td></tr>`;
    const indent = r.section === "perq" || r.section === "less" || r.section === "hp" || r.section === "vi-a";
    const style = r.bold ? "font-weight:600;border-top:1px solid var(--line);" : indent ? "padding-left:24px;" : "";
    return `<tr style="${style}"><td>${escapeHtml(r.label)}</td><td>${fmt(r.old)}</td><td>${fmt(r.new)}</td></tr>`;
  };
  return `
    <div class="card">
      <table>
        <thead><tr><th></th><th>Old Regime</th><th>New Regime</th></tr></thead>
        <tbody>
          <tr style="font-weight:600;"><td>Tax Liability</td><td>${rupees(estimate.old.totalTaxLiability)}</td><td>${rupees(estimate.new.totalTaxLiability)}</td></tr>
          <tr style="font-weight:600;"><td>Tax Savings</td><td>-</td><td style="background:${savings > 0 ? "color-mix(in srgb, var(--good) 20%, transparent)" : savings < 0 ? "color-mix(in srgb, var(--bad) 20%, transparent)" : "transparent"};">${savings === 0 ? "-" : rupees(Math.abs(savings))}</td></tr>
          <tr><td colspan="3">&nbsp;</td></tr>
          <tr><td colspan="3"><strong>Income from Salary</strong></td></tr>
          ${rows.map(rowHtml).join("")}
        </tbody>
      </table>
      <p class="text-muted mt-16" style="font-size:12px;">"NA" means that head doesn't apply under the New Regime at all (e.g. HRA/LTA exemption, Chapter VI-A deductions other than employer NPS, self-occupied house property interest set-off) - "-" means the head applies but comes to zero for this employee.</p>
    </div>
  `;
}

function renderRegimeComparisonTab(container, employee, fy, onSaved) {
  const estimate = PayrollEngine.estimateRegimeComparison(db, employee.id, fy.id);
  if (!estimate) {
    container.innerHTML = `<div class="card text-muted">No active salary structure for FY ${fy.code} yet - add one under the Salary Structure tab to see a regime comparison.</div>`;
    return;
  }
  const otherRegime = employee.taxRegime === "OLD" ? "NEW" : "OLD";
  const preview = PayrollEngine.previewRegimeSwitch(db, employee.id, fy.id);
  const history = employee.regimeSwitchHistory || [];

  container.innerHTML = `
    <div class="card row between">
      <div>
        <p style="margin:0;">Estimated annual gross salary: <strong>${rupees(estimate.annualGross)}</strong>. Based on the current active Salary Structure and Investment Declaration for FY ${fy.code}, projected for the full year.</p>
        ${!estimate.hasDeclaration ? `<p class="text-bad">No Investment Declaration is on file yet - Old Regime figures assume zero Chapter VI-A deductions/HRA rent.</p>` : ""}
      </div>
      <a href="#/employees/${employee.id}/form16"><button>View Form 16 Part B Summary</button></a>
    </div>
    ${renderComputationTable(estimate)}
    ${
      estimate.old.warnings.length || estimate.new.warnings.length
        ? `<div class="card text-muted" style="font-size:12px;">${[...new Set([...estimate.old.warnings, ...estimate.new.warnings])].map((w) => `<div>&#9888; ${escapeHtml(w)}</div>`).join("")}</div>`
        : ""
    }
    <div class="card">
      <h3>Switch Tax Regime</h3>
      <p class="text-muted" style="font-size:12px;">An employee can revise the regime intimated to their employer for TDS purposes during the year - it isn't locked at joining. Switching only affects future payroll runs; already-withheld TDS for past months is never touched. The remaining months' TDS is automatically trued up against what's already been deducted, whichever regime you switch to.</p>
      <p>Currently on: <span class="badge good">${sentenceCase(employee.taxRegime)} regime</span></p>
      ${
        preview.hasUpcomingRun
          ? `<p>For ${monthLabel(preview)} onward (the next open run), monthly TDS would be <strong>${rupees(preview.currentRegime === "OLD" ? preview.oldMonthlyTds : preview.newMonthlyTds)}</strong> staying on ${sentenceCase(preview.currentRegime).toLowerCase()}, vs <strong>${rupees(preview.currentRegime === "OLD" ? preview.newMonthlyTds : preview.oldMonthlyTds)}</strong> if you switch to ${sentenceCase(otherRegime).toLowerCase()}.</p>`
          : `<p class="text-muted">No open payroll run exists yet to preview the exact monthly impact - the figures above (full-year estimate) are the best available preview. The next run you process after switching will compute the correct trued-up TDS automatically.</p>`
      }
      <button id="btn-switch-regime">Switch to ${sentenceCase(otherRegime)} regime</button>
      <div id="regime-switch-error" class="text-bad mt-16"></div>
      ${
        history.length
          ? `<h3 class="mt-16">Switch History</h3><table><thead><tr><th>Date</th><th>From</th><th>To</th></tr></thead><tbody>${history
              .slice()
              .reverse()
              .map((h) => `<tr><td>${h.changedAt.slice(0, 10)}</td><td>${sentenceCase(h.from)}</td><td>${sentenceCase(h.to)}</td></tr>`)
              .join("")}</tbody></table>`
          : ""
      }
    </div>
  `;

  document.getElementById("btn-switch-regime").addEventListener("click", async () => {
    const errorEl = document.getElementById("regime-switch-error");
    errorEl.textContent = "";
    if (!confirm(`Switch ${employee.fullName} from ${sentenceCase(employee.taxRegime).toLowerCase()} to ${sentenceCase(otherRegime).toLowerCase()} regime? This takes effect from the next payroll run onward.`)) return;
    const fromRegime = employee.taxRegime;
    try {
      PayrollEngine.applyRegimeSwitch(db, employee.id, otherRegime);
      logAudit("Employee", employee.id, "REGIME_SWITCH", `${employee.fullName} (${employee.employeeCode}) switched from ${fromRegime} to ${otherRegime} regime`);
      await persist();
      onSaved();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// --- Form 16 Part B Summary ------------------------------------------------
function renderForm16(container, employee) {
  const fy = currentFy();
  if (!fy) {
    container.innerHTML = `<div class="card">No Financial Year configured.</div>`;
    return;
  }
  const estimate = PayrollEngine.estimateRegimeComparison(db, employee.id, fy.id);
  if (!estimate) {
    container.innerHTML = `<div class="card">No active salary structure for FY ${fy.code} - add one under Salary Structure first. <a href="#/employees/${employee.id}">Back</a></div>`;
    return;
  }
  const r = employee.taxRegime === "OLD" ? estimate.old : estimate.new;
  const company = db.companies.find((c) => c.id === employee.companyId) || {};

  container.innerHTML = `
    <div class="row between no-print">
      <a href="#/employees/${employee.id}"><button>&larr; Back to Employee</button></a>
      <button id="btn-print-form16">Print / Save as PDF</button>
    </div>
    <div class="card mt-16">
      <div class="row between" style="border-bottom:2px solid var(--line); padding-bottom:8px;">
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(company.name || "")}</h2>
          <div class="text-muted">PAN: ${company.pan || "-"}  TAN: ${company.tan || "-"}</div>
        </div>
        <div class="text-muted" style="text-align:right;">
          <div>Annual Tax Computation Statement</div>
          <div>FY ${fy.code} (${sentenceCase(r.regime)} regime)</div>
        </div>
      </div>
      <h2 style="text-align:center;">Form 16 Part B - Computation of Income &amp; Tax</h2>
      <div class="card-grid">
        <table>
          <tr><td class="text-muted">Employee Code</td><td>${escapeHtml(employee.employeeCode)}</td></tr>
          <tr><td class="text-muted">Employee Name</td><td>${escapeHtml(employee.fullName)}</td></tr>
          <tr><td class="text-muted">PAN</td><td>${employee.pan || "-"}</td></tr>
          <tr><td class="text-muted">Designation</td><td>${escapeHtml(employee.designation || "-")}</td></tr>
        </table>
        <table>
          <tr><td class="text-muted">Financial Year</td><td>${fy.code}</td></tr>
          <tr><td class="text-muted">Tax Regime</td><td>${sentenceCase(r.regime)}</td></tr>
          <tr><td class="text-muted">Period</td><td>${fy.startDate} to ${fy.endDate}</td></tr>
        </table>
      </div>

      <h3 class="mt-16">Computation of Income under the Head "Salaries"</h3>
      <table>
        <tbody>
          ${r.steps
            .map((s) => {
              const row = `<tr><td>${escapeHtml(s.label)}${s.note ? ` <span class="text-muted">(${escapeHtml(s.note)})</span>` : ""}</td><td>${rupees(s.amount)}</td></tr>`;
              if (!s.label.startsWith("Gross Salary (current employer)")) return row;
              const breakup = Object.entries(estimate.earningsAnnual || {})
                .filter(([, amt]) => amt !== 0)
                .map(([code, amt]) => `<tr><td class="text-muted" style="padding-left:28px;font-size:13px;">${SLIP_COMPONENT_LABELS[code] || sentenceCase(code)}</td><td class="text-muted" style="font-size:13px;">${rupees(amt)}</td></tr>`)
                .join("");
              return row + breakup;
            })
            .join("")}
        </tbody>
      </table>

      <h3 class="mt-16">Chapter VI-A Deductions</h3>
      <table>
        <thead><tr><th>Section</th><th>Amount Claimed</th><th>Amount Allowed</th></tr></thead>
        <tbody>
          ${r.chapterVIABreakdown.map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${rupees(d.actual)}</td><td>${rupees(d.allowed)}</td></tr>`).join("") || `<tr><td colspan="3" class="text-muted">None (not applicable under this regime, or none declared).</td></tr>`}
        </tbody>
      </table>

      <div class="row between" style="background:var(--ink); padding:10px 16px; border-radius:8px; margin-top:16px;">
        <strong>Total Tax Liability</strong><strong>${rupees(r.totalTaxLiability)}</strong>
      </div>
      <div class="row between" style="padding:10px 16px;">
        <span>Less: TDS Already Deducted</span><span>${rupees(r.tdsAlreadyDeducted)}</span>
      </div>
      <div class="row between" style="padding:10px 16px; font-weight:600;">
        <span>Balance Tax Payable</span><span>${rupees(r.balanceTaxPayable)}</span>
      </div>

      ${r.warnings.length ? `<div class="text-muted mt-16" style="font-size:12px;">${r.warnings.map((w) => `<div>&#9888; ${escapeHtml(w)}</div>`).join("")}</div>` : ""}
      <p class="text-muted mt-16" style="text-align:center; font-size:12px;">This is a system-generated tax computation summary (Form 16 Part B style), not an official Form 16 certificate requiring a TRACES-issued certificate number and digital signature.</p>
    </div>
  `;
  document.getElementById("btn-print-form16").addEventListener("click", () => window.print());
}

// --- Full & Final Settlement ---------------------------------------------
const GRATUITY_EXEMPTION_CAP = 2000000; // New Sec 19 (old Sec 10(10)): statutory ceiling for non-government employees (as of the last amendment raising it from Rs 10L to Rs 20L).

/** Completed years of service for gratuity, per Sec 4(2) of the Payment of Gratuity Act: a part-year of 6 months or more rounds up to a full year, less than 6 months rounds down. */
function computeServiceYears(dateOfJoining, dateOfLeaving) {
  const start = new Date(dateOfJoining);
  const end = new Date(dateOfLeaving);
  let totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) totalMonths -= 1;
  totalMonths = Math.max(0, totalMonths);
  const completedYears = Math.floor(totalMonths / 12);
  const extraMonths = totalMonths % 12;
  const roundedYears = extraMonths >= 6 ? completedYears + 1 : completedYears;
  return { completedYears, extraMonths, roundedYears, totalMonths };
}

function renderFnfTab(container, employee, fy, onSaved) {
  const activeStructure = db.employeeSalaryStructures
    .filter((s) => s.employeeId === employee.id && s.financialYearId === fy.id && s.isActive)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
  const basicPlusDaMonthly = activeStructure ? activeStructure.components.filter((c) => c.componentCode === "BASIC" || c.componentCode === "DA").reduce((s, c) => s + c.monthlyAmount, 0) : 0;

  const service = computeServiceYears(employee.dateOfJoining, employee.dateOfLeaving);
  const gratuityEligible = service.roundedYears >= 5;
  const statutoryGratuity = Math.round(((basicPlusDaMonthly * 15) / 26) * service.roundedYears);

  const leaveDate = new Date(employee.dateOfLeaving);
  const lastWorkingFyMonthIndex = calendarToFyMonthIndex(leaveDate.getFullYear(), leaveDate.getMonth() + 1);
  const finalRun = db.payrollRuns.find((r) => r.companyId === employee.companyId && r.financialYearId === fy.id && r.payrollMonthIndex === lastWorkingFyMonthIndex && !r.payrollGroup);
  const finalLine = finalRun ? finalRun.lines.find((l) => l.employeeId === employee.id) : null;

  container.innerHTML = `
    <div class="card">
      <h3>Service Summary</h3>
      <div class="card-grid">
        <div><div class="stat-label">Date of Joining</div><div>${employee.dateOfJoining}</div></div>
        <div><div class="stat-label">Date of Leaving</div><div>${employee.dateOfLeaving}</div></div>
        <div><div class="stat-label">Service Period</div><div>${service.roundedYears} year(s) (${service.completedYears}y ${service.extraMonths}m exact)</div></div>
        <div><div class="stat-label">Last Drawn Basic+DA (monthly)</div><div>${rupees(basicPlusDaMonthly)}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>Gratuity (Payment of Gratuity Act, 1972)</h3>
      ${
        !gratuityEligible
          ? `<p class="text-bad">Not eligible: fewer than 5 years of completed service (waived only for death or disablement - if that applies here, you can still enter an amount below).</p>`
          : `<p class="text-muted">Statutory formula: Last drawn Basic+DA x 15/26 x completed years of service (6+ months rounds up) = ${rupees(basicPlusDaMonthly)} x 15/26 x ${service.roundedYears} = <strong>${rupees(statutoryGratuity)}</strong></p>`
      }
      <div class="form-grid">
        <div><label>Gratuity to Pay</label><input type="number" min="0" id="fnf-gratuity" value="${gratuityEligible ? statutoryGratuity : 0}" /></div>
      </div>
      <p class="text-muted mt-16" style="font-size:12px;">Exempt from tax up to the LEAST of: actual amount, Rs ${GRATUITY_EXEMPTION_CAP.toLocaleString("en-IN")} (lifetime, new Sec 19 / old Sec 10(10)), or the statutory formula above. If you pay more than that exemption (an ex-gratia top-up), the excess is taxable salary income - add it separately via this employee's "LOP &amp; Bonus" override on the final payroll run if so, since it isn't auto-added here.</p>
    </div>

    <div class="card">
      <h3>Leave Encashment</h3>
      <div class="form-grid">
        <div><label>Leave Days to Encash</label><input type="number" min="0" id="fnf-leave-days" value="0" /></div>
        <div><label>Per-Day Rate</label><input type="number" min="0" id="fnf-leave-rate" value="${Math.round(basicPlusDaMonthly / 30)}" /></div>
      </div>
      <p class="text-muted mt-16" style="font-size:12px;">Exempt under new Sec 19 (old Sec 10(10AA)) up to a lifetime limit (Rs 25,00,000 for non-government employees) - most ordinary encashment amounts are well within this; verify separately if this employee is close to that lifetime cap across employers.</p>
    </div>

    <div class="card">
      <h3>Notice Pay Recovery</h3>
      <div class="form-grid">
        <div><label>Amount to Recover (shortfall in notice period)</label><input type="number" min="0" id="fnf-notice-recovery" value="0" /></div>
      </div>
    </div>

    <div class="card">
      <h3>Post to Final Payroll Run</h3>
      ${
        !finalRun
          ? `<p class="text-bad">No payroll run exists yet for their last working month (FY month ${lastWorkingFyMonthIndex}). <a href="#/payroll-runs">Create and calculate it first</a>, then come back here.</p>`
          : !finalLine
            ? `<p class="text-bad">That run exists but hasn't been calculated for this employee yet. Open it and click "Run Calculation" first.</p>`
            : `<p class="text-muted">Will post Gratuity and Leave Encashment as additions, and Notice Pay Recovery as a deduction, to ${escapeHtml(employee.fullName)}'s line on the ${finalRun.calendarMonth}/${finalRun.calendarYear} run - each as a labeled, audited Manual Adjustment.</p>
              <div class="row gap-8 mt-16"><button class="primary" id="btn-post-fnf">Post to Final Payroll Run</button></div>`
      }
      <div id="fnf-error" class="text-bad mt-16"></div>
    </div>
  `;

  const postBtn = document.getElementById("btn-post-fnf");
  if (postBtn) {
    postBtn.addEventListener("click", async () => {
      const errorEl = document.getElementById("fnf-error");
      errorEl.textContent = "";
      const gratuity = num(document.getElementById("fnf-gratuity").value);
      const leaveDays = num(document.getElementById("fnf-leave-days").value);
      const leaveRate = num(document.getElementById("fnf-leave-rate").value);
      const leaveEncashment = Math.round(leaveDays * leaveRate);
      const noticeRecovery = num(document.getElementById("fnf-notice-recovery").value);
      try {
        if (gratuity) PayrollEngine.addAdjustment(db, finalLine.id, { amount: gratuity, reason: `Gratuity (${service.roundedYears} years of service)`, enteredBy: "F&F Settlement" });
        if (leaveEncashment) PayrollEngine.addAdjustment(db, finalLine.id, { amount: leaveEncashment, reason: `Leave Encashment (${leaveDays} days @ ${rupees(leaveRate)})`, enteredBy: "F&F Settlement" });
        if (noticeRecovery) PayrollEngine.addAdjustment(db, finalLine.id, { amount: -noticeRecovery, reason: "Notice Pay Recovery", enteredBy: "F&F Settlement" });
        logAudit("Employee", employee.id, "FNF_SETTLEMENT", `F&F posted for ${employee.fullName}: gratuity ${rupees(gratuity)}, leave encashment ${rupees(leaveEncashment)}, notice recovery ${rupees(noticeRecovery)}`);
        await persist();
        alert("Posted to the final payroll run. Open Payroll Runs to review and advance its status as usual.");
        onSaved();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }
}
