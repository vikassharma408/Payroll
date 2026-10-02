// State-wise Professional Tax slabs. Professional Tax (PT) is levied under
// each state's own Act, so rates/thresholds vary by state and several states
// levy none at all. Independently researched (WebSearch, Sep-Oct 2026)
// against Kredily, HROne, EZHRM, SalaryBox, TaxGuru and TankhaPay's state-wise
// PT guides; cross-checked across at least 2 sources per state. These are
// seeded as editable data (see db.ptSlabs / the "PT Slabs" setup screen) -
// not hard-coded into the engine - since states revise rates periodically
// (e.g. Odisha abolished PT entirely effective 1 April 2026) and the only
// way to keep this correct over time is to let it be corrected without a
// code change.
//
// SENIOR CITIZEN EXEMPTION: several state PT Acts exempt employees who have
// crossed a certain age entirely, regardless of salary - modeled here as
// `seniorExemptionAge` (PT goes to 0 once the employee reaches it that
// month). Every MONTHLY/HALF_YEARLY state was researched for this (WebSearch,
// Oct 2026); set only where at least 2 independent sources agreed on the
// exact age (one of them a primary government source for Assam) - left
// unset elsewhere rather than guessed (see per-state notes: West Bengal's
// sources still conflict 60 vs 65 after 3 separate searches, Bihar's Act
// has no age-based exemption at all, and Punjab's flat Development Tax ties
// senior treatment to income rather than a flat age cutoff).

const PT_STATES = [
  {
    key: "MAHARASHTRA", label: "Maharashtra", type: "MONTHLY",
    seniorExemptionAge: 65, // Maharashtra State Tax on Professions, Trades, Callings and Employments Act, 1975 - exempts persons who have completed 65 years, irrespective of income.
    slabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: null, amount: 200 },
    ],
    note: "Rs 200/month, except Rs 300 in February (to reach the Rs 2,500 annual cap) - simplified here to a flat Rs 200/month; adjust February manually if you need the exact cap. Employees aged 65+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "KARNATAKA", label: "Karnataka", type: "MONTHLY",
    seniorExemptionAge: 60, // Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976 - senior citizens (60+) are an exempted class.
    slabs: [
      { upTo: 25000, amount: 0 },
      { upTo: 41666, amount: 150 },
      { upTo: null, amount: 200 },
    ],
    note: "Employees aged 60+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "WEST_BENGAL", label: "West Bengal", type: "MONTHLY",
    slabs: [
      { upTo: 10000, amount: 0 },
      { upTo: 15000, amount: 110 },
      { upTo: 25000, amount: 130 },
      { upTo: 40000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
    note: "Sources conflict on whether a senior-citizen exemption applies at 60 or at 65 (checked across 3 separate searches, still unresolved) - no seniorExemptionAge is set here. Verify with the WB Commercial Taxes Dept and fill it in above if you confirm one.",
  },
  {
    key: "ANDHRA_PRADESH", label: "Andhra Pradesh", type: "MONTHLY",
    seniorExemptionAge: 65, // AP Tax on Professions, Trades, Callings and Employments Act, 1987 - exempts persons over 65 (matches Telangana below, which shares the same pre-bifurcation Act).
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
    note: "Employees aged 65+ are fully exempt (see seniorExemptionAge). A minority of sources say 60 instead of 65 - verify with the AP Commercial Taxes Dept if in doubt.",
  },
  {
    key: "TELANGANA", label: "Telangana", type: "MONTHLY",
    seniorExemptionAge: 65, // Telangana Tax on Professions, Trades, Callings and Employments Act, 1987 - exempts persons over 65.
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
    note: "Employees aged 65+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "GUJARAT", label: "Gujarat", type: "MONTHLY",
    seniorExemptionAge: 65, // Gujarat Panchayats, Municipalities, Municipal Corporations and State Tax on Professions, Trades, Callings and Employments Act, 1976 - exempts persons over 65.
    slabs: [
      { upTo: 5999, amount: 0 },
      { upTo: 8999, amount: 80 },
      { upTo: 11999, amount: 150 },
      { upTo: null, amount: 200 },
    ],
    note: "Employees aged 65+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "MADHYA_PRADESH", label: "Madhya Pradesh", type: "MONTHLY",
    seniorExemptionAge: 65, // MP Vritti Kar Adhiniyam (Professional Tax Act) - exempts senior citizens over 65.
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 18000, amount: 125 },
      { upTo: null, amount: 208.33 },
    ],
    note: "Employees aged 65+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "ASSAM", label: "Assam", type: "MONTHLY",
    seniorExemptionAge: 60, // Assam Commercial Taxes Dept notification FTX.41/2010/5 (31 May 2010, re-confirming an earlier FTX.38/05/33 dated 8 Jun 2005) - exemption of tax for any person above 60 years.
    slabs: [
      { upTo: 10000, amount: 0 },
      { upTo: 15000, amount: 150 },
      { upTo: null, amount: 208 },
    ],
    note: "Employees aged 60+ are fully exempt (see seniorExemptionAge), per the Assam Commercial Taxes Dept's own published notification.",
  },
  {
    key: "BIHAR", label: "Bihar", type: "MONTHLY",
    slabs: [
      { upTo: 25000, amount: 0 },
      { upTo: 41666, amount: 83 },
      { upTo: null, amount: 208 },
    ],
    note: "Researched specifically for a senior-citizen exemption and found none - the Bihar Tax on Professions, Trades, Callings and Employments Act, 2011 exempts only Armed Forces personnel, not an age band. No seniorExemptionAge is set here.",
  },
  {
    key: "TAMIL_NADU", label: "Tamil Nadu", type: "HALF_YEARLY",
    seniorExemptionAge: 65, // Tamil Nadu Panchayats Act / City Municipal Corporation Act profession tax rules - exempts persons over 65.
    slabs: [
      { upTo: 21000, amount: 0 },
      { upTo: 30000, amount: 135 },
      { upTo: 45000, amount: 315 },
      { upTo: 60000, amount: 690 },
      { upTo: 75000, amount: 1025 },
      { upTo: null, amount: 1250 },
    ],
    note: "Charged half-yearly on half-yearly gross; shown here as an averaged monthly equivalent (half-yearly slab amount / 6) for routine monthly payroll processing. Verify actual remittance periods separately. Employees aged 65+ are fully exempt (see seniorExemptionAge).",
  },
  {
    key: "KERALA", label: "Kerala", type: "HALF_YEARLY",
    seniorExemptionAge: 65, // Kerala Panchayat Raj (Profession Tax) Rules, 1996 / Kerala Municipality Act, 1994 Sec 254 - exempts senior citizens over 65 in both panchayat and municipal/corporation areas.
    slabs: [
      { upTo: 11999, amount: 0 },
      { upTo: 17999, amount: 120 },
      { upTo: 29999, amount: 180 },
      { upTo: 44999, amount: 300 },
      { upTo: 99999, amount: 450 },
      { upTo: null, amount: 1200 },
    ],
    note: "Charged half-yearly (June/December) on half-yearly gross; shown here as an averaged monthly equivalent (half-yearly slab amount / 6) for routine monthly payroll processing. Employees aged 65+ are fully exempt (see seniorExemptionAge) - must be claimed, per source commentary, rather than being automatic; this app applies it automatically.",
  },
  { key: "DELHI", label: "Delhi", type: "NONE" },
  { key: "UTTAR_PRADESH", label: "Uttar Pradesh", type: "NONE" },
  { key: "HARYANA", label: "Haryana", type: "NONE" },
  { key: "RAJASTHAN", label: "Rajasthan", type: "NONE" },
  { key: "HIMACHAL_PRADESH", label: "Himachal Pradesh", type: "NONE" },
  {
    key: "PUNJAB", label: "Punjab", type: "FLAT", amount: 200,
    note: "Punjab does not levy Professional Tax; this is the flat Rs 200/month Punjab State Development Tax (2018), commonly deducted the same way. Its senior-citizen treatment isn't a simple age cutoff - PSDT FAQs tie it to whether the employee's income still exceeds the higher income-tax exemption threshold given to seniors, so no seniorExemptionAge is modeled here; handle an exempt senior by unchecking PT Applicable on their Profile.",
  },
  {
    key: "ODISHA", label: "Odisha", type: "NONE",
    note: "Professional Tax was abolished in Odisha by ordinance effective 1 April 2026.",
  },
  { key: "MANUAL", label: "Other / Not Listed - enter manually", type: "MANUAL" },
];

/**
 * Computes this month's Professional Tax for a given state + that month's
 * gross salary. `ptSlabsList` is normally `db.ptSlabs` (the editable, live
 * copy) rather than the static PT_STATES above, so edits made in the PT
 * Slabs screen take effect. `employeeAge` (completed years as of the
 * payroll month, see dates.js computeAge) triggers the state's senior
 * citizen exemption, if any, once reached - pass null/undefined if the
 * employee's date of birth isn't known. Returns null for MANUAL/unknown
 * state (caller should fall back to the salary structure's own fixed PT
 * component).
 */
function computeMonthlyPT(ptSlabsList, stateKey, monthlyGross, employeeAge) {
  const state = (ptSlabsList || PT_STATES).find((s) => s.key === stateKey);
  if (!state || state.type === "MANUAL") return null;
  if (state.seniorExemptionAge != null && employeeAge != null && employeeAge >= state.seniorExemptionAge) return 0;
  if (state.type === "NONE") return 0;
  if (state.type === "FLAT") return state.amount;

  const basisGross = state.type === "HALF_YEARLY" ? monthlyGross * 6 : monthlyGross;
  const slab = state.slabs.find((s) => s.upTo == null || basisGross <= s.upTo) || state.slabs[state.slabs.length - 1];
  return state.type === "HALF_YEARLY" ? Math.round((slab.amount / 6) * 100) / 100 : slab.amount;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PT_STATES, computeMonthlyPT };
}
