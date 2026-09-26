import type { SurchargeSlabConfig } from "@/lib/types";

export interface SurchargeResult {
  surcharge: number;
  applicableRate: number;
  marginalReliefApplied: boolean;
  steps: string[];
}

/**
 * Surcharge with marginal relief: at each threshold, surcharge is the lesser
 * of (a) tax at the slab's own rate and (b) tax at the next-lower slab's rate
 * plus the income in excess of the threshold - so crossing a surcharge
 * threshold never reduces take-home by more than the extra income earned.
 * `slabsDescending` must be sorted by threshold, highest first.
 */
export function computeSurcharge(
  taxableIncome: number,
  taxBeforeSurcharge: number,
  slabsDescending: SurchargeSlabConfig[],
): SurchargeResult {
  for (let i = 0; i < slabsDescending.length; i++) {
    const { threshold, rate } = slabsDescending[i];
    if (taxableIncome > threshold) {
      const prevRate = i + 1 < slabsDescending.length ? slabsDescending[i + 1].rate : 0;
      const fullSurcharge = taxBeforeSurcharge * rate;
      const reliefCapped = taxBeforeSurcharge * prevRate + (taxableIncome - threshold);
      const surcharge = Math.round(Math.min(fullSurcharge, reliefCapped));
      const marginalReliefApplied = reliefCapped < fullSurcharge;
      return {
        surcharge,
        applicableRate: rate,
        marginalReliefApplied,
        steps: [
          `Taxable income Rs ${taxableIncome.toLocaleString("en-IN")} > Rs ${threshold.toLocaleString("en-IN")} => surcharge slab ${rate * 100}%`,
          marginalReliefApplied
            ? `Marginal relief applied: surcharge capped at tax(prev slab ${prevRate * 100}%) + income over threshold = Rs ${surcharge.toLocaleString("en-IN")}`
            : `Surcharge = ${rate * 100}% of tax = Rs ${surcharge.toLocaleString("en-IN")}`,
        ],
      };
    }
  }
  return { surcharge: 0, applicableRate: 0, marginalReliefApplied: false, steps: ["No surcharge applicable"] };
}
