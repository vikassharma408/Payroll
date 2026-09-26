# PayrollIN - Indian Payroll & Monthly Salary Register

A payroll, TDS and salary-register application for Indian businesses, built with
Next.js (App Router), TypeScript, Prisma/SQLite and Tailwind CSS.

It is built around a **config-driven tax rule engine** (not hard-coded slabs)
so tax parameters can be updated FY-by-FY, and every calculated figure is
traceable back to the rule/formula that produced it.

## Quick start

```bash
npm install
npx prisma migrate deploy   # creates prisma/dev.db and applies the schema
npm run db:seed             # seeds financial years, tax rules, master data,
                             # and 3 demo employees (Mr. A / Mr. B / Mr. C)
                             # matching the reference FY 2026-27 workbook
npm run dev                 # http://localhost:3000
```

To verify the tax engine reproduces the reference workbook's figures exactly:

```bash
npm run tax:validate
```

## Architecture

```
lib/
  types.ts               Shared domain types (Regime, PayrollStatus, ...)
  tax-engine/
    rule-configs.ts       FY 2024-25 .. 2027-28 rule sets (slabs, rebate,
                           surcharge, cess, deduction limits, HRA %) as data,
                           not code - this is what "config-driven" means here.
    calculate.ts          Pure calculateTax(input, config) -> full audit trail
    surcharge.ts          Marginal-relief surcharge calculation
    hra.ts                Month-wise Sec 10(13A) HRA exemption
    index.ts              DB-backed resolver: FY + regime + effective date
                           -> TaxRuleSetConfig (falls back to nothing silently
                           - throws if a FY/regime isn't configured, so the
                           app never silently uses outdated rules)
    __tests__/validate-fixtures.ts
                           Reproduces Mr. A / Mr. B / Mr. C from the supplied
                           FY 2026-27 workbook to the rupee (run via
                           `npm run tax:validate`)
  formula-engine/          Safe (no eval) arithmetic expression evaluator for
                           salary-structure formulas ("40% of CTC", "50% of
                           BASIC", "CTC - BASIC - HRA - EMPLOYER_PF"), with
                           dependency-ordered resolution and a human-readable
                           trace for every resolved amount.
  payroll/
    engine.ts              Monthly payroll calculation: resolves the active
                           salary structure, prorates for LOP, projects the
                           annual income (YTD actuals + this month + projected
                           remaining months), calls the tax engine for BOTH
                           regimes, and stores both snapshots so the UI can
                           show a full Old vs New comparison regardless of
                           which regime is selected for TDS.
    workflow.ts             Draft -> Calculated -> Reviewed -> Approved ->
                           Locked -> Paid status machine + audited manual
                           adjustments (amount/reason/enteredBy/timestamp).
  reports/, bank-file.ts, pdf/salary-slip.tsx, import/
                           Salary register, bank payment file (configurable
                           per-bank column templates), salary slip PDF, and
                           the Import Wizard (Excel templates, validation,
                           import summary + downloadable error report).
prisma/schema.prisma        Data model. SQLite has no native enum type, so
                           Regime/PayrollStatus/etc. are plain `String`
                           columns constrained by the TS unions in
                           lib/types.ts and validated with zod at every
                           write boundary (lib/validation.ts).
prisma/seed.ts               Seeds FYs/tax rules/components/bank templates and
                           3 demo employees, and runs April/May 2026 payroll
                           end-to-end so YTD, regime comparison and the
                           workflow states have real data to look at.
app/                         Next.js App Router pages + Server Actions
                           (lib/actions/*) for mutations, and Route Handlers
                           (app/api/**) for binary responses (Excel/CSV/PDF
                           downloads, import uploads).
```

## Tax engine correctness

The engine's Old/New regime calculation (slabs, standard deduction, Sec 87A
rebate incl. marginal relief, surcharge incl. marginal relief, Health &
Education Cess, Sec 80C/80D/80CCD/80E/80EE/80EEA/80U/80DD, HRA exemption,
Sec 17(1)(viii)/17(2)(vii) employer NPS/PF/superannuation treatment, house
property set-off) was built directly against, and is unit-tested against, the
FY 2026-27 salary/TDS workbook supplied by the business - `npm run tax:validate`
reproduces Mr. A (₹89,294 new-regime / ₹2,40,209 old-regime annual tax), Mr. B
(senior citizen, surcharge-triggering income) and Mr. C (full Sec 87A rebate
under the new regime) to the rupee.

**Adding a new financial year or amending a rule mid-year:** add a
`TaxRuleSetConfig` entry in `lib/tax-engine/rule-configs.ts` (or insert a
`TaxRuleSet` row directly - the Tax Rules page also lets an admin edit the key
parameters and slab rates for an existing rule set in place) and re-run
`npm run db:seed`, or insert via Prisma directly for a live database. The
engine always resolves the latest rule set whose `effectiveFrom` is on or
before the calculation date for that FY + regime, and throws rather than
silently falling back if none exists - so an unconfigured year is never
computed on outdated assumptions. Rows where the underlying provision needed
interpretation (e.g. Sec 80G's donee-dependent 50%/100% treatment, or the
FY 2027-28 rule set which is a provisional carry-forward pending that year's
Finance Act) carry an explicit assumption/warning shown in the UI rather than
being silently assumed.

## What's implemented vs. simplified

Implemented end-to-end: employee master, flexible salary structure with a
formula engine, investment declarations, previous-employer income, monthly
payroll processing with the Draft-to-Paid workflow and audited manual
adjustments, YTD tracking, Old vs New regime comparison with a full
"View Calculation" audit trail, salary register (filter/search/export),
salary slips (view/print/PDF), configurable bank payment file export with
validation, the Import Wizard (5 templates, validation, error report) for
bulk data loading, a payroll dashboard with trend charts, 14 report types,
and month-over-month reconciliation with flagged variances.

Deliberately out of scope for this pass, called out so nobody is surprised:

- **Authentication/authorization**: there's a `User`/`Company` model but no
  login flow - this is a single-tenant internal tool as built. Add NextAuth
  (or similar) in front of it before exposing it beyond a trusted intranet.
- **Email delivery** for salary slips: the button and audit-log hook exist
  (`lib/actions/slip.ts`), but no SMTP/email provider is configured in this
  environment - wire one up there to enable real delivery.
- **Bonus timing**: the seed data spreads each demo employee's annual bonus
  evenly across 12 months (for tax-calculation correctness) rather than
  modeling the reference workbook's lump-sum April payout; a real lump-sum
  bonus should be entered as a one-off Manual Adjustment on that month's
  payroll line (demonstrated in the seed data on Mr. C's April run) or via a
  dedicated recurring/one-time earnings distinction, which would be the
  natural next enhancement to the salary-structure model.
- **Sec 80G** is modeled as fully deductible; the actual 50%/100% and
  qualifying-limit treatment depends on the specific donee and is flagged as
  an assumption in the Tax Rules page rather than silently assumed.
