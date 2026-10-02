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

const PT_STATES = [
  {
    key: "MAHARASHTRA", label: "Maharashtra", type: "MONTHLY",
    slabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: null, amount: 200 },
    ],
    note: "Rs 200/month, except Rs 300 in February (to reach the Rs 2,500 annual cap) - simplified here to a flat Rs 200/month; adjust February manually if you need the exact cap.",
  },
  {
    key: "KARNATAKA", label: "Karnataka", type: "MONTHLY",
    slabs: [
      { upTo: 25000, amount: 0 },
      { upTo: 41666, amount: 150 },
      { upTo: null, amount: 200 },
    ],
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
  },
  {
    key: "ANDHRA_PRADESH", label: "Andhra Pradesh", type: "MONTHLY",
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  {
    key: "TELANGANA", label: "Telangana", type: "MONTHLY",
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  {
    key: "GUJARAT", label: "Gujarat", type: "MONTHLY",
    slabs: [
      { upTo: 5999, amount: 0 },
      { upTo: 8999, amount: 80 },
      { upTo: 11999, amount: 150 },
      { upTo: null, amount: 200 },
    ],
  },
  {
    key: "MADHYA_PRADESH", label: "Madhya Pradesh", type: "MONTHLY",
    slabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 18000, amount: 125 },
      { upTo: null, amount: 208.33 },
    ],
  },
  {
    key: "ASSAM", label: "Assam", type: "MONTHLY",
    slabs: [
      { upTo: 10000, amount: 0 },
      { upTo: 15000, amount: 150 },
      { upTo: null, amount: 208 },
    ],
  },
  {
    key: "BIHAR", label: "Bihar", type: "MONTHLY",
    slabs: [
      { upTo: 25000, amount: 0 },
      { upTo: 41666, amount: 83 },
      { upTo: null, amount: 208 },
    ],
  },
  {
    key: "TAMIL_NADU", label: "Tamil Nadu", type: "HALF_YEARLY",
    slabs: [
      { upTo: 21000, amount: 0 },
      { upTo: 30000, amount: 135 },
      { upTo: 45000, amount: 315 },
      { upTo: 60000, amount: 690 },
      { upTo: 75000, amount: 1025 },
      { upTo: null, amount: 1250 },
    ],
    note: "Charged half-yearly on half-yearly gross; shown here as an averaged monthly equivalent (half-yearly slab amount / 6) for routine monthly payroll processing. Verify actual remittance periods separately.",
  },
  {
    key: "KERALA", label: "Kerala", type: "HALF_YEARLY",
    slabs: [
      { upTo: 11999, amount: 0 },
      { upTo: 17999, amount: 120 },
      { upTo: 29999, amount: 180 },
      { upTo: 44999, amount: 300 },
      { upTo: 99999, amount: 450 },
      { upTo: null, amount: 1200 },
    ],
    note: "Charged half-yearly (June/December) on half-yearly gross; shown here as an averaged monthly equivalent (half-yearly slab amount / 6) for routine monthly payroll processing.",
  },
  { key: "DELHI", label: "Delhi", type: "NONE" },
  { key: "UTTAR_PRADESH", label: "Uttar Pradesh", type: "NONE" },
  { key: "HARYANA", label: "Haryana", type: "NONE" },
  { key: "RAJASTHAN", label: "Rajasthan", type: "NONE" },
  { key: "HIMACHAL_PRADESH", label: "Himachal Pradesh", type: "NONE" },
  {
    key: "PUNJAB", label: "Punjab", type: "FLAT", amount: 200,
    note: "Punjab does not levy Professional Tax; this is the flat Rs 200/month Punjab State Development Tax (2018), commonly deducted the same way.",
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
 * Slabs screen take effect. Returns null for MANUAL/unknown state (caller
 * should fall back to the salary structure's own fixed PT component).
 */
function computeMonthlyPT(ptSlabsList, stateKey, monthlyGross) {
  const state = (ptSlabsList || PT_STATES).find((s) => s.key === stateKey);
  if (!state || state.type === "MANUAL") return null;
  if (state.type === "NONE") return 0;
  if (state.type === "FLAT") return state.amount;

  const basisGross = state.type === "HALF_YEARLY" ? monthlyGross * 6 : monthlyGross;
  const slab = state.slabs.find((s) => s.upTo == null || basisGross <= s.upTo) || state.slabs[state.slabs.length - 1];
  return state.type === "HALF_YEARLY" ? Math.round((slab.amount / 6) * 100) / 100 : slab.amount;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PT_STATES, computeMonthlyPT };
}
