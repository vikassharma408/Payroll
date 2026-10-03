// Import Wizard: download the combined setup template (with an Instructions
// tab) or individual per-entity templates, and upload a filled-in workbook
// to bulk-create/update employees, salary structures, investment
// declarations, previous employer records, or a month's variable pay.

registerView("import", "Payroll", "Import Wizard", (container) => {
  let lastDownloadUrl = null;

  /**
   * Triggers the usual synthetic-click auto-download AND renders a real,
   * persistent, directly-clickable link underneath - some browsers/security
   * policies silently swallow a script-triggered download with no visible
   * error (reported: works in Edge, not in Chrome, on the same machine), so
   * the visible link is the actual fallback that doesn't depend on that
   * auto-click succeeding. Right-click "Save Link As" also works on it.
   */
  function offerDownload(filename, arrayBuffer) {
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    lastDownloadUrl = URL.createObjectURL(blob);
    const linkEl = document.getElementById("template-download-link");
    if (linkEl) {
      linkEl.innerHTML = `<a href="${lastDownloadUrl}" download="${escapeHtml(filename)}" id="ready-download-link"><button>&#8595; ${escapeHtml(filename)} - click here if the download didn't start automatically</button></a>`;
    }
    downloadWorkbook(filename, arrayBuffer);
  }

  function render() {
    if (db.companies.length === 0) {
      container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
      return;
    }
    const defaultCompanyId = getActiveCompanyId();
    container.innerHTML = `
      <div class="card">
        <div class="form-grid">
          <div>
            <label>Default Company (Legal Entity)</label>
            <select id="default-company-select">${db.companies.map((c) => `<option value="${c.id}" ${c.id === defaultCompanyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
          </div>
        </div>
        <p class="text-muted" style="font-size:12px;">Used only when a row's own "Legal Entity" column is left blank (or for sheets that don't have that column) - every row with an explicit Legal Entity always goes to that company instead, regardless of this setting.</p>
        <h3>1. Download a Template</h3>
        <p class="text-muted">The Combined Setup Template covers everything you need for onboarding many employees at once (Employee Master, Salary Structure, Investment Declaration, Previous Employer), plus a step-by-step Instructions tab. Use Monthly Payroll Input separately, each pay period, for LOP days or one-off bonus/incentive/overtime/arrears.</p>
        <div class="row gap-8">
          <button class="primary" id="btn-download-combined">Download Combined Setup Template</button>
        </div>
        <div class="row gap-8 mt-16">
          <select id="single-template-select">
            <option value="EMPLOYEE">Employee Master</option>
            <option value="SALARY_STRUCTURE">Salary Structure</option>
            <option value="INVESTMENT">Investment Declaration</option>
            <option value="PREVIOUS_EMPLOYER">Previous Employer</option>
            <option value="MONTHLY_PAYROLL">Monthly Payroll Input</option>
          </select>
          <button id="btn-download-single">Download This Template</button>
        </div>
        <div id="template-download-link" class="mt-16"></div>
      </div>

      <div class="card">
        <h3>2. Upload &amp; Import</h3>
        <div class="form-grid">
          <div>
            <label>Combined Setup Template</label>
            <input type="file" id="combined-file-input" accept=".xlsx,.xls" />
          </div>
          <div>
            <label>Or a single template</label>
            <div class="row gap-8">
              <select id="upload-template-select">
                <option value="EMPLOYEE">Employee Master</option>
                <option value="SALARY_STRUCTURE">Salary Structure</option>
                <option value="INVESTMENT">Investment Declaration</option>
                <option value="PREVIOUS_EMPLOYER">Previous Employer</option>
                <option value="MONTHLY_PAYROLL">Monthly Payroll Input</option>
              </select>
              <input type="file" id="single-file-input" accept=".xlsx,.xls" style="flex:1;" />
            </div>
          </div>
        </div>
        <div id="import-result" class="mt-16"></div>
      </div>

      <div class="card">
        <h3>Import History</h3>
        <table>
          <thead><tr><th>File</th><th>Type</th><th>Total</th><th>Imported</th><th>Failed</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            ${
              db.importBatches
                .slice()
                .reverse()
                .map((b) => `<tr><td>${escapeHtml(b.fileName)}</td><td>${sentenceCase(b.templateType)}</td><td>${b.totalRecords}</td><td>${b.importedRecords}</td><td>${b.failedRecords}</td><td><span class="badge ${b.status === "COMPLETED" ? "good" : b.status === "FAILED" ? "bad" : "neutral"}">${sentenceCase(b.status)}</span></td><td>${b.createdAt.slice(0, 16).replace("T", " ")}</td></tr>`)
                .join("") || `<tr><td colspan="7" class="text-muted">No imports yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("default-company-select").addEventListener("change", (e) => {
      setActiveCompanyId(e.target.value);
    });

    document.getElementById("btn-download-combined").addEventListener("click", async () => {
      offerDownload("payroll-combined-setup-template.xlsx", await buildCombinedTemplateWorkbook(db));
    });
    document.getElementById("btn-download-single").addEventListener("click", async () => {
      const type = document.getElementById("single-template-select").value;
      offerDownload(`${IMPORT_TEMPLATES[type].sheetName.toLowerCase().replace(/\s+/g, "-")}-template.xlsx`, await buildTemplateWorkbook(type, db));
    });

    document.getElementById("combined-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const companyId = document.getElementById("default-company-select").value;
      try {
        const buf = await file.arrayBuffer();
        const batch = runCombinedImport(db, buf, file.name, companyId);
        await persist();
        render();
        showResult(batch);
      } catch (err) {
        showError(err.message);
      }
      e.target.value = "";
    });

    document.getElementById("single-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const type = document.getElementById("upload-template-select").value;
      const companyId = document.getElementById("default-company-select").value;
      try {
        const buf = await file.arrayBuffer();
        const batch = runSingleImport(db, type, buf, file.name, companyId);
        await persist();
        render();
        showResult(batch);
      } catch (err) {
        showError(err.message);
      }
      e.target.value = "";
    });
  }

  function showResult(batch) {
    const el = document.getElementById("import-result");
    if (!el) return;
    el.innerHTML = `
      <div class="card" style="background:var(--ink);">
        <p><strong>${sentenceCase(batch.status)}</strong>: imported ${batch.importedRecords} of ${batch.totalRecords} row(s)${batch.failedRecords ? `, ${batch.failedRecords} failed` : ""}.</p>
        ${batch.errors.length ? `<ul>${batch.errors.map((e) => `<li>Row ${e.rowNumber}: ${escapeHtml(e.message)}</li>`).join("")}</ul>` : ""}
      </div>
    `;
  }
  function showError(message) {
    const el = document.getElementById("import-result");
    if (el) el.innerHTML = `<div class="card text-bad">${escapeHtml(message)}</div>`;
  }

  render();
});
