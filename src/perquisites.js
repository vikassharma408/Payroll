// Perquisite valuation - taxable under Sec 17(2)/Sec 17(1) of the salary
// head. Covers the two most commonly declared types (gift vouchers,
// employer-provided car) plus a manual "Other" catch-all for anything else
// (rent-free accommodation, ESOPs, interest-free loans, club membership,
// etc.) that isn't separately modeled here - those still need the taxable
// value worked out by hand and entered directly.
//
// The computed total feeds into the tax engine's existing `perquisitesOther`
// input (see payroll-engine.js), which was always summed into gross salary
// but had no UI path to set it until now.
//
// RATES CHANGED UNDER THE INCOME-TAX ACT, 2025: the Income-tax Act, 1961 and
// its Rule 3 (Income-tax Rules, 1962) were replaced by the Income-tax Act,
// 2025 and Rule 15 of the Income-tax Rules, 2026, both effective 1 April
// 2026 (Tax Year/FY 2026-27 onwards). Rule 15 revised the motor-car flat
// rates (unchanged since 2009) and tripled the gift/voucher exemption
// threshold. Payroll for FY 2025-26 and earlier must still use the old
// Rule 3 figures, so rates are resolved by the financial year's start date
// rather than hard-coded as a single global constant - the same
// effective-dated approach already used for Tax Rule Sets.

const PERQUISITE_LAW_CHANGE_DATE = "2026-04-01"; // Income-tax Act, 2025 / Income-tax Rules, 2026 commencement.

const PERQUISITE_RATE_CARDS = [
  {
    key: "LEGACY_RULE_3",
    effectiveFrom: "1900-01-01",
    label: "Income-tax Rules, 1962 (Rule 3) - up to FY 2025-26",
    giftExemptionThreshold: 5000, // Rule 3(7)(iv)
    carFlatMonthlyRate: { UPTO_1600CC: 1800, ABOVE_1600CC: 2400 }, // Rule 3(2)(A)
    carDriverFlatMonthlyRate: 900, // Rule 3(2)(A)
    carDepreciationRatePa: 0.1, // Rule 3(2)(B)
    ruleRef: "Rule 3",
  },
  {
    key: "NEW_RULE_15",
    effectiveFrom: PERQUISITE_LAW_CHANGE_DATE,
    label: "Income-tax Rules, 2026 (Rule 15, under the Income-tax Act, 2025) - FY 2026-27 onwards",
    giftExemptionThreshold: 15000, // Rule 15(5)(a) - tripled from Rs 5,000.
    carFlatMonthlyRate: { UPTO_1600CC: 5000, ABOVE_1600CC: 7000 }, // Rule 15(2)(a) - up from Rs 1,800/2,400.
    carDriverFlatMonthlyRate: 3000, // Rule 15(2)(a) - up from Rs 900.
    carDepreciationRatePa: 0.1, // Rule 15(2)(b) - normal wear and tear rate unchanged.
    ruleRef: "Rule 15",
  },
];

/** Resolves the rate card in force on a given date (FY start date, a payroll month, etc.), via latest-effectiveFrom-<=-date, same resolution pattern as Tax Rule Sets. Falls back to the newest card if no date is given. */
function getPerquisiteRates(asOfDate) {
  if (!asOfDate) return PERQUISITE_RATE_CARDS[PERQUISITE_RATE_CARDS.length - 1];
  const asOf = new Date(asOfDate);
  const applicable = PERQUISITE_RATE_CARDS.filter((c) => new Date(c.effectiveFrom) <= asOf);
  return applicable.length ? applicable[applicable.length - 1] : PERQUISITE_RATE_CARDS[0];
}

const PERQUISITE_TYPES = [
  { key: "GIFT_VOUCHER", label: "Gift / Gift Voucher" },
  { key: "CAR", label: "Company Car" },
  { key: "OTHER", label: "Other Perquisite (manual value)" },
];

/** Taxable value of a single CAR perquisite entry, under the given rate card (see getPerquisiteRates). */
function computeCarPerquisiteValue(entry, rates) {
  const r = rates || getPerquisiteRates();
  const monthsUsed = entry.monthsUsed || 12;
  if (entry.usageType === "OFFICIAL_ONLY") {
    return { value: 0, note: "Used wholly for official duties - not a taxable perquisite (ensure this is documented/supportable)." };
  }
  if (entry.usageType === "WHOLLY_PERSONAL") {
    const depreciation = (entry.depreciationBase || 0) * r.carDepreciationRatePa * (monthsUsed / 12);
    const value = Math.max(0, (entry.runningMaintenanceCost || 0) + (entry.driverSalary || 0) + depreciation - (entry.recoveredFromEmployee || 0));
    return { value, note: `Wholly personal use (${r.ruleRef}): running/maintenance + driver salary + ${r.carDepreciationRatePa * 100}% p.a. depreciation of cost, less amount recovered from employee.` };
  }
  // PARTLY_PERSONAL (the common case: used for both office and personal purposes)
  const monthlyRate = (r.carFlatMonthlyRate[entry.engineCategory] || r.carFlatMonthlyRate.UPTO_1600CC) + (entry.hasDriver ? r.carDriverFlatMonthlyRate : 0);
  const value = monthlyRate * monthsUsed;
  return { value, note: `Partly personal use (${r.ruleRef}): flat Rs ${monthlyRate.toLocaleString("en-IN")}/month x ${monthsUsed} month(s), regardless of actual running cost.` };
}

/**
 * Totals taxable perquisite value across all of one employee's declared
 * entries for a FY. Gifts are aggregated first (the exemption is on the
 * YEAR'S TOTAL gifts, not per gift); cars and other entries are each valued
 * independently. `asOfDate` (typically the financial year's startDate)
 * selects which rate card applies - see PERQUISITE_RATE_CARDS above.
 */
function computePerquisitesTotal(entries, asOfDate) {
  const rates = getPerquisiteRates(asOfDate);
  const breakdown = [];
  let total = 0;

  const giftEntries = entries.filter((e) => e.type === "GIFT_VOUCHER");
  if (giftEntries.length) {
    const giftTotal = giftEntries.reduce((s, e) => s + (e.amount || 0), 0);
    const taxable = giftTotal > rates.giftExemptionThreshold ? giftTotal : 0;
    total += taxable;
    breakdown.push({
      id: null,
      type: "GIFT_VOUCHER",
      label: `Gifts/Vouchers (${giftEntries.length} item(s), Rs ${giftTotal.toLocaleString("en-IN")} total)`,
      taxableValue: taxable,
      note:
        taxable > 0
          ? `Aggregate gifts Rs ${giftTotal.toLocaleString("en-IN")} exceed the Rs ${rates.giftExemptionThreshold.toLocaleString("en-IN")} exemption, so the FULL amount is taxable (${rates.ruleRef}), not just the excess.`
          : `Aggregate gifts Rs ${giftTotal.toLocaleString("en-IN")} are within the Rs ${rates.giftExemptionThreshold.toLocaleString("en-IN")} exemption - not taxable.`,
    });
  }

  for (const e of entries.filter((e) => e.type === "CAR")) {
    const { value, note } = computeCarPerquisiteValue(e, rates);
    total += value;
    breakdown.push({ id: e.id, type: "CAR", label: e.description || "Company Car", taxableValue: value, note });
  }

  for (const e of entries.filter((e) => e.type === "OTHER")) {
    const value = e.taxableValue || 0;
    total += value;
    breakdown.push({ id: e.id, type: "OTHER", label: e.label || "Other Perquisite", taxableValue: value, note: e.note || "Manually entered taxable value - verify against the applicable Rule valuation yourself." });
  }

  return { total, breakdown, rates };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PERQUISITE_TYPES, PERQUISITE_RATE_CARDS, PERQUISITE_LAW_CHANGE_DATE, getPerquisiteRates, computeCarPerquisiteValue, computePerquisitesTotal };
}
