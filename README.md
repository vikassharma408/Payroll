# Payroll Register - Indian Payroll & Monthly Salary Register

A standalone, offline-first payroll, TDS and salary-register app for Indian
businesses. No server, no database to install, no build step - it's a folder
of plain HTML/CSS/JS. Open `html-app/index.html` in a browser (Chrome or
Edge recommended) and it runs entirely client-side.

It is built around a **config-driven tax rule engine** (not hard-coded
slabs) so tax parameters can be updated FY-by-FY, and every calculated
figure is traceable back to the rule/formula that produced it.

## Quick start

Double-click `html-app/index.html` (or open it from your browser's File menu).
That's it - no installation, no `npm install`, no server to start.

- Your data (employees, salary structures, payroll runs, everything) is
  saved automatically in the browser via IndexedDB, so it survives closing
  and reopening the file.
- **Backup & Restore** (in the sidebar) lets you download a full JSON backup
  at any time, restore from one, or - on Chrome/Edge - pick a folder once so
  every change is written there automatically, with no need to remember to
  back up manually.

To re-verify the tax engine reproduces the reference workbook's figures
exactly:

```bash
node html-app/src/validate-fixtures.js
```

(This only needs Node.js if you want to re-run that specific check; the app
itself needs nothing but a browser.)

## Architecture

```
html-app/
  index.html               The app shell: sidebar, theme, script includes.
  vendor/
    xlsx.full.min.js        SheetJS, vendored so the Import Wizard reads/
                             writes real .xlsx files fully offline.
  src/
    rule-configs.js         FY 2026-27 / 2027-28 rule sets (slabs, rebate,
                             surcharge, cess, deduction limits, HRA %) as
                             data, not code - this is what "config-driven"
                             means here.
    tax-engine.js            Pure calculateTax(input, config) -> full audit
                             trail, computeSurcharge (marginal relief),
                             monthlyHraExemption (Sec 10(13A)).
    formula-engine.js         Safe (no eval) arithmetic expression evaluator
                             for salary-structure formulas ("40% of CTC",
                             "50% of BASIC", "CTC - BASIC - HRA -
                             EMPLOYER_PF"), with dependency-ordered
                             resolution and a human-readable trace for
                             every resolved amount.
    payroll-engine.js         Monthly payroll calculation: resolves the
                             active salary structure, prorates for LOP,
                             projects the annual income (YTD actuals + this
                             month + projected remaining months), calls the
                             tax engine for BOTH regimes, and stores both
                             snapshots so the UI can show a full Old vs New
                             comparison regardless of which regime is
                             selected for TDS. Also: the Draft -> Calculated
                             -> Reviewed -> Approved -> Locked -> Paid
                             workflow, audited manual adjustments, and the
                             standalone regime-comparison estimator.
    reports.js                Salary register, bank payment file (per-bank
                             column templates), 13 report types, and
                             month-over-month reconciliation with flagged
                             variances.
    import.js                 The Import Wizard: combined + per-entity
                             Excel templates (with an Instructions tab and
                             required-field "*" markers) and the row-level
                             import/validation logic.
    db.js                    The in-memory "database": one JSON-serializable
                             object tree (this is exactly what a backup file
                             contains).
    persistence.js            IndexedDB auto-save, manual backup download/
                             restore, and the File System Access API
                             folder auto-save.
    app.js, bootstrap.js       Router, sidebar/theme chrome, app boot.
    views/                     One file per screen (Employees, Payroll
                             Runs + Salary Register/Slip/Bank File,
                             Reports/Reconciliation/Company Settings,
                             Import Wizard).
```

Every calculation file above (`tax-engine.js`, `formula-engine.js`,
`payroll-engine.js`, `rule-configs.js`) is a verbatim, logic-for-logic port -
not a rewrite - and is re-verified against the same reference-workbook
fixtures on every change (`node html-app/src/validate-fixtures.js`).

## Tax engine correctness

The engine's Old/New regime calculation (slabs, standard deduction, Sec 87A
rebate incl. marginal relief, surcharge incl. marginal relief, Health &
Education Cess, Sec 80C/80D/80CCD/80E/80EE/80EEA/80U/80DD, HRA exemption,
Sec 17(1)(viii)/17(2)(vii) employer NPS/PF/superannuation treatment, house
property set-off) was built directly against, and is unit-tested against, the
FY 2026-27 salary/TDS workbook supplied by the business -
`node html-app/src/validate-fixtures.js` reproduces Mr. A (₹89,294 new-regime
/ ₹2,40,209 old-regime annual tax), Mr. B (senior citizen, surcharge-
triggering income) and Mr. C (full Sec 87A rebate under the new regime) to
the rupee.

**Adding a new financial year or amending a rule mid-year:** add a rule-set
entry in `html-app/src/rule-configs.js`. The engine always resolves the
latest rule set whose `effectiveFrom` is on or before the calculation date
for that FY + regime, and throws rather than silently falling back if none
exists - so an unconfigured year is never computed on outdated assumptions.
Rows where the underlying provision needed interpretation (e.g. Sec 80G's
donee-dependent 50%/100% treatment, or the FY 2027-28 rule set which is a
provisional carry-forward pending that year's Finance Act) carry an explicit
assumption/warning shown in the UI rather than being silently assumed.

## What's implemented vs. simplified

Implemented end-to-end: employee master, flexible salary structure with a
formula engine, investment declarations, previous-employer income, monthly
payroll processing with the Draft-to-Paid workflow and audited manual
adjustments, YTD tracking, Old vs New regime comparison, salary register
(export to CSV), salary slips (view/print/save-as-PDF via the browser),
configurable bank payment file export with validation, the Import Wizard
(5 templates, validation, error report) for bulk data loading, a payroll
dashboard, 13 report types, and month-over-month reconciliation with
flagged variances - plus backup/restore and folder auto-save, since there's
no server-side database to fall back on.

Deliberately out of scope for this pass, called out so nobody is surprised:

- **Multi-user / authentication**: this is a single-user, single-browser
  tool by design (data lives in that browser's IndexedDB plus whatever
  backup file/folder you choose) - it is not intended to be shared between
  multiple people editing concurrently.
- **Email delivery** for salary slips: slips are viewed/printed/saved as PDF
  from the browser; no email sending is wired up.
- **Sec 80G** is modeled as fully deductible; the actual 50%/100% and
  qualifying-limit treatment depends on the specific donee and is flagged as
  an assumption in the Tax Rules page rather than silently assumed.
- **Browser support for folder auto-save**: the File System Access API
  (used for "pick a folder, auto-save there") is Chromium-only (Chrome,
  Edge). Other browsers can still use manual download/restore backups.
