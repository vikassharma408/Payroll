// Salary Structure Templates: a company-level, reusable CTC breakup (e.g.
// "Basic = 40% of CTC", "HRA = 50% of Basic") that an employee's Salary
// Structure tab can expand into a concrete monthly/annual structure just by
// entering a target CTC. Resolution itself lives in formula-engine.js
// (resolveSalaryStructure) and is wired up via
// PayrollEngine.generateStructureFromTemplate/expandSalaryTemplate.

registerView("salary-templates", "Setup", "Salary Structure Templates", renderTemplatesList);
registerDetailView("salary-templates", (container, segments) => {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> first.</p></div>`;
    return;
  }
  const [id] = segments;
  if (id === "new") return renderTemplateForm(container, null);
  const template = db.salaryStructureTemplates.find((t) => t.id === id);
  if (!template) {
    container.innerHTML = `<div class="card">Template not found. <a href="#/salary-templates">Back to Salary Structure Templates</a></div>`;
    return;
  }
  renderTemplateForm(container, template);
});

function renderTemplatesList(container) {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const viewCompanyIds = filteredCompanyIds();
  const showCompanyColumn = viewCompanyIds.length > 1;
  const templates = db.salaryStructureTemplates.filter((t) => viewCompanyIds.includes(t.companyId));
  const rows = templates
    .map(
      (t) => `
      <tr>
        <td><a href="#/salary-templates/${t.id}">${escapeHtml(t.name)}</a></td>
        ${showCompanyColumn ? `<td>${escapeHtml((db.companies.find((c) => c.id === t.companyId) || {}).name || "-")}</td>` : ""}
        <td>${t.components.length}</td>
        <td>${t.includeGratuityInCTC ? "Included in CTC" : "Added on top of CTC"}</td>
      </tr>`,
    )
    .join("");
  container.innerHTML = `
    <div class="row between" style="margin-bottom:16px;">
      <span class="text-muted">Define a reusable CTC breakup once; generate any employee's monthly + annual Salary Structure from it by entering just their CTC (see the Salary Structure tab on an Employee). Pick the Legal Entity when creating a new template.</span>
      <a href="#/salary-templates/new"><button class="primary">+ New Template</button></a>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th>${showCompanyColumn ? "<th>Company</th>" : ""}<th>Components</th><th>Gratuity</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${showCompanyColumn ? 4 : 3}" class="text-muted">No templates yet for ${escapeHtml(companyFilterLabel())}.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderTemplateForm(container, template) {
  const isEdit = !!template;
  let companyId = isEdit ? template.companyId : getActiveCompanyId();
  let name = template ? template.name : "";
  let includeGratuityInCTC = template ? !!template.includeGratuityInCTC : true;
  let rows = template ? template.components.map((c) => ({ ...c })) : [];
  let previewCtc = "";

  function render() {
    const options = db.salaryComponents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => `<option value="${c.code}">${c.code} - ${c.name} (${sentenceCase(c.category)})</option>`)
      .join("");

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? "Edit" : "New"} Salary Structure Template</h3>
        <div class="form-grid">
          <div><label>Template Name *</label><input id="tpl-name" value="${escapeHtml(name)}" placeholder="e.g. Standard - Grade A" /></div>
          <div>
            <label>Legal Entity *</label>
            ${
              isEdit
                ? `<input value="${escapeHtml((db.companies.find((c) => c.id === companyId) || {}).name || "-")}" disabled title="A template's Legal Entity can't be changed after creation." />`
                : `<select id="tpl-company-select">${db.companies.map((c) => `<option value="${c.id}" ${c.id === companyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>`
            }
          </div>
        </div>
        <label class="row gap-8 mt-16" style="display:flex;align-items:center;">
          <input type="checkbox" id="tpl-gratuity-toggle" ${includeGratuityInCTC ? "checked" : ""} style="width:auto;" /> Include Gratuity in CTC
        </label>
        <p class="text-muted" style="font-size:12px;">If a Gratuity row is included below, this decides whether it's treated as already part of the CTC figure you'll enter per employee (so your other formulas should carve out room for it, e.g. a balancing allowance that subtracts GRATUITY too), or added on top as extra employer cost - shown separately as "Total cost to company" wherever this template is used.</p>

        <h4 class="mt-16">Components</h4>
        <p class="text-muted" style="font-size:12px;">
          Formula syntax: percentages and references to other components or CTC, e.g. <code>40% of CTC</code>, <code>50% of BASIC</code>, <code>CTC - BASIC - HRA - EMPLOYER_PF - EMPLOYER_NPS - GRATUITY</code>. Leave the formula blank to use a fixed annual amount instead (e.g. a flat Rs 19,200/year Conveyance). A component can reference any other component by its code, resolved in dependency order automatically.
        </p>
        <table class="mt-16">
          <thead><tr><th>Component</th><th>Formula</th><th>Fixed Annual Amount (if no formula)</th><th></th></tr></thead>
          <tbody id="tpl-rows-body"></tbody>
        </table>
        <div class="row gap-8 mt-16">
          <select id="tpl-add-component">${options}</select>
          <button id="tpl-btn-add-row">+ Add Component</button>
        </div>
        <div id="tpl-error" class="text-bad mt-16"></div>
        <div class="row gap-8 mt-16">
          <button class="primary" id="tpl-btn-save">${isEdit ? "Save Changes" : "Create Template"}</button>
          <a href="#/salary-templates"><button type="button">Cancel</button></a>
          ${isEdit ? `<button type="button" class="danger" id="tpl-btn-delete" style="margin-left:auto;">Delete</button>` : ""}
        </div>
      </div>

      <div class="card">
        <h3>Preview</h3>
        <p class="text-muted" style="font-size:12px;">Try a sample CTC against the rows above (even before saving) to check the breakup looks right.</p>
        <div class="row gap-8" style="align-items:flex-end;">
          <div><label>Sample Annual CTC</label><input type="number" min="0" id="tpl-preview-ctc" value="${previewCtc}" placeholder="e.g. 1200000" /></div>
          <button id="tpl-btn-preview">Preview</button>
        </div>
        <div id="tpl-preview-error" class="text-bad mt-16"></div>
        <div id="tpl-preview-result" class="mt-16"></div>
      </div>
    `;
    renderRows();

    document.getElementById("tpl-name").addEventListener("input", (e) => { name = e.target.value; });
    const companySelectEl = document.getElementById("tpl-company-select");
    if (companySelectEl) companySelectEl.addEventListener("change", (e) => { companyId = e.target.value; setActiveCompanyId(companyId); });
    document.getElementById("tpl-gratuity-toggle").addEventListener("change", (e) => { includeGratuityInCTC = e.target.checked; });
    document.getElementById("tpl-btn-add-row").addEventListener("click", () => {
      const code = document.getElementById("tpl-add-component").value;
      if (!code || rows.some((r) => r.componentCode === code)) return;
      rows.push({ componentCode: code, formula: "", fixedAnnualAmount: 0 });
      renderRows();
    });
    document.getElementById("tpl-btn-preview").addEventListener("click", () => {
      previewCtc = document.getElementById("tpl-preview-ctc").value;
      const errorEl = document.getElementById("tpl-preview-error");
      const resultEl = document.getElementById("tpl-preview-result");
      errorEl.textContent = "";
      resultEl.innerHTML = "";
      try {
        const draft = { id: "preview", name: name || "Untitled", includeGratuityInCTC, components: rows };
        const result = PayrollEngine.expandSalaryTemplate(db, draft, num(previewCtc));
        resultEl.innerHTML = `
          <table>
            <thead><tr><th>Component</th><th>Monthly</th><th>Annual</th><th>How it was computed</th></tr></thead>
            <tbody>
              ${result.components.map((c) => `<tr><td>${c.componentCode}</td><td>${rupees(c.monthlyAmount)}</td><td>${rupees(c.annualAmount)}</td><td class="text-muted" style="font-size:12px;">${escapeHtml(c.formulaTrace)}</td></tr>`).join("")}
            </tbody>
          </table>
          <div class="row between mt-16"><strong>Total Cost to Company</strong><strong>${rupees(result.totalCostToCompany)}</strong></div>
        `;
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
    document.getElementById("tpl-btn-save").addEventListener("click", async () => {
      const errorEl = document.getElementById("tpl-error");
      errorEl.textContent = "";
      if (!name.trim()) {
        errorEl.textContent = "Template name is required.";
        return;
      }
      if (rows.length === 0) {
        errorEl.textContent = "Add at least one component.";
        return;
      }
      if (!isEdit && !companyId) {
        errorEl.textContent = "Select a Legal Entity.";
        return;
      }
      const data = { name: name.trim(), includeGratuityInCTC, components: rows.map((r) => ({ componentCode: r.componentCode, formula: r.formula || "", fixedAnnualAmount: num(r.fixedAnnualAmount) })) };
      let targetId;
      if (isEdit) {
        Object.assign(template, data);
        targetId = template.id;
        logAudit("SalaryStructureTemplate", targetId, "UPDATE", `Updated template "${data.name}"`);
      } else {
        const newTemplate = { id: newId("sst"), companyId, createdAt: new Date().toISOString(), ...data };
        db.salaryStructureTemplates.push(newTemplate);
        targetId = newTemplate.id;
        logAudit("SalaryStructureTemplate", targetId, "CREATE", `Created template "${data.name}"`);
      }
      await persist();
      navigate(`salary-templates/${targetId}`);
    });
    const deleteBtn = document.getElementById("tpl-btn-delete");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete template "${template.name}"? Employee structures already generated from it are unaffected.`)) return;
        db.salaryStructureTemplates = db.salaryStructureTemplates.filter((t) => t.id !== template.id);
        logAudit("SalaryStructureTemplate", template.id, "DELETE", `Deleted template "${template.name}"`);
        await persist();
        navigate("salary-templates");
      });
    }
  }

  function renderRows() {
    const tbody = document.getElementById("tpl-rows-body");
    tbody.innerHTML = rows
      .map((r, i) => {
        const comp = db.salaryComponents.find((c) => c.code === r.componentCode);
        return `
        <tr>
          <td>${comp ? `${comp.code} - ${comp.name}` : r.componentCode}</td>
          <td><input data-idx="${i}" type="text" class="tpl-formula-input" value="${escapeHtml(r.formula || "")}" placeholder="e.g. 40% of CTC" style="width:220px;" /></td>
          <td><input data-idx="${i}" type="number" min="0" class="tpl-fixed-input" value="${r.fixedAnnualAmount || 0}" ${r.formula ? "disabled" : ""} /></td>
          <td><button data-idx="${i}" class="danger tpl-remove-row">Remove</button></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".tpl-formula-input").forEach((el) =>
      el.addEventListener("input", (e) => {
        const row = rows[Number(e.target.dataset.idx)];
        row.formula = e.target.value;
        const fixedInput = e.target.closest("tr").querySelector(".tpl-fixed-input");
        if (fixedInput) fixedInput.disabled = !!row.formula;
      }),
    );
    tbody.querySelectorAll(".tpl-fixed-input").forEach((el) =>
      el.addEventListener("input", (e) => {
        rows[Number(e.target.dataset.idx)].fixedAnnualAmount = num(e.target.value);
      }),
    );
    tbody.querySelectorAll(".tpl-remove-row").forEach((el) =>
      el.addEventListener("click", (e) => {
        rows.splice(Number(e.target.dataset.idx), 1);
        renderRows();
      }),
    );
  }

  render();
}
