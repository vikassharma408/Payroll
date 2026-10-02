// Perquisite valuation - Rule 3 of the Income-tax Rules, 1962 (perquisites
// taxable under Sec 17(2)). Covers the two most commonly declared types
// (gift vouchers, employer-provided car) plus a manual "Other" catch-all for
// anything else (rent-free accommodation, ESOPs, interest-free loans, club
// membership, etc.) that isn't separately modeled here - those still need
// the taxable value worked out by hand and entered directly.
//
// The computed total feeds into the tax engine's existing `perquisitesOther`
// input (see payroll-engine.js), which was always summed into gross salary
// but had no UI path to set it until now.

const GIFT_EXEMPTION_THRESHOLD = 5000; // Rule 3(7)(iv): if aggregate gifts in the year exceed this, the WHOLE amount is taxable, not just the excess.
const CAR_FLAT_MONTHLY_RATE = { UPTO_1600CC: 1800, ABOVE_1600CC: 2400 }; // Rule 3(2)(A), car used partly for official + partly personal purposes, employer-owned/hired.
const CAR_DRIVER_FLAT_MONTHLY_RATE = 900; // Rule 3(2)(A), additional if employer also provides a chauffeur.
const CAR_DEPRECIATION_RATE_PA = 0.1; // Rule 3(2)(B): wholly-personal-use employer-owned car - 10% p.a. of cost stands in for actual depreciation.

const PERQUISITE_TYPES = [
  { key: "GIFT_VOUCHER", label: "Gift / Gift Voucher" },
  { key: "CAR", label: "Company Car" },
  { key: "OTHER", label: "Other Perquisite (manual value)" },
];

/** Taxable value of a single CAR perquisite entry. */
function computeCarPerquisiteValue(entry) {
  const monthsUsed = entry.monthsUsed || 12;
  if (entry.usageType === "OFFICIAL_ONLY") {
    return { value: 0, note: "Used wholly for official duties - not a taxable perquisite (ensure this is documented/supportable)." };
  }
  if (entry.usageType === "WHOLLY_PERSONAL") {
    const depreciation = (entry.depreciationBase || 0) * CAR_DEPRECIATION_RATE_PA * (monthsUsed / 12);
    const value = Math.max(0, (entry.runningMaintenanceCost || 0) + (entry.driverSalary || 0) + depreciation - (entry.recoveredFromEmployee || 0));
    return { value, note: "Wholly personal use (Rule 3(2)(B)): running/maintenance + driver salary + 10% p.a. depreciation of cost, less amount recovered from employee." };
  }
  // PARTLY_PERSONAL (the common case: used for both office and personal purposes)
  const monthlyRate = (CAR_FLAT_MONTHLY_RATE[entry.engineCategory] || CAR_FLAT_MONTHLY_RATE.UPTO_1600CC) + (entry.hasDriver ? CAR_DRIVER_FLAT_MONTHLY_RATE : 0);
  const value = monthlyRate * monthsUsed;
  return { value, note: `Partly personal use (Rule 3(2)(A)): flat Rs ${monthlyRate.toLocaleString("en-IN")}/month x ${monthsUsed} month(s), regardless of actual running cost.` };
}

/**
 * Totals taxable perquisite value across all of one employee's declared
 * entries for a FY. Gifts are aggregated first (the Rs 5,000 exemption is on
 * the YEAR'S TOTAL gifts, not per gift); cars and other entries are each
 * valued independently.
 */
function computePerquisitesTotal(entries) {
  const breakdown = [];
  let total = 0;

  const giftEntries = entries.filter((e) => e.type === "GIFT_VOUCHER");
  if (giftEntries.length) {
    const giftTotal = giftEntries.reduce((s, e) => s + (e.amount || 0), 0);
    const taxable = giftTotal > GIFT_EXEMPTION_THRESHOLD ? giftTotal : 0;
    total += taxable;
    breakdown.push({
      id: null,
      type: "GIFT_VOUCHER",
      label: `Gifts/Vouchers (${giftEntries.length} item(s), Rs ${giftTotal.toLocaleString("en-IN")} total)`,
      taxableValue: taxable,
      note:
        taxable > 0
          ? `Aggregate gifts Rs ${giftTotal.toLocaleString("en-IN")} exceed the Rs ${GIFT_EXEMPTION_THRESHOLD.toLocaleString("en-IN")} exemption, so the FULL amount is taxable (Rule 3(7)(iv)), not just the excess.`
          : `Aggregate gifts Rs ${giftTotal.toLocaleString("en-IN")} are within the Rs ${GIFT_EXEMPTION_THRESHOLD.toLocaleString("en-IN")} exemption - not taxable.`,
    });
  }

  for (const e of entries.filter((e) => e.type === "CAR")) {
    const { value, note } = computeCarPerquisiteValue(e);
    total += value;
    breakdown.push({ id: e.id, type: "CAR", label: e.description || "Company Car", taxableValue: value, note });
  }

  for (const e of entries.filter((e) => e.type === "OTHER")) {
    const value = e.taxableValue || 0;
    total += value;
    breakdown.push({ id: e.id, type: "OTHER", label: e.label || "Other Perquisite", taxableValue: value, note: e.note || "Manually entered taxable value - verify against the applicable Rule 3 valuation yourself." });
  }

  return { total, breakdown };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PERQUISITE_TYPES, GIFT_EXEMPTION_THRESHOLD, CAR_FLAT_MONTHLY_RATE, CAR_DRIVER_FLAT_MONTHLY_RATE, computeCarPerquisiteValue, computePerquisitesTotal };
}
