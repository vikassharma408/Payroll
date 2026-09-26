import type { HraConfig } from "@/lib/types";

export interface MonthlyHraInput {
  basic: number;
  hraReceived: number;
  rentPaid: number;
  isMetro: boolean;
}

/**
 * Section 10(13A) read with Rule 2A: HRA exemption for one month is the
 * least of (a) actual HRA received, (b) rent paid minus 10% of Basic+DA,
 * (c) 50%/40% of Basic+DA (metro/non-metro). Computed month-wise because
 * basic, HRA and rent can all change mid-year.
 */
export function monthlyHraExemption(input: MonthlyHraInput, config: HraConfig): number {
  const a = input.hraReceived;
  const b = Math.max(input.rentPaid - 0.1 * input.basic, 0);
  const c = (input.isMetro ? config.metroPercent : config.nonMetroPercent) * input.basic;
  return Math.max(0, Math.min(a, b, c));
}
