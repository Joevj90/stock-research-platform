import type { PriceBar } from "@/lib/types";

/**
 * Simple moving average over `period` bars, computed strictly from the
 * real historical bars passed in (from the market-data service — never
 * fabricated). Returns one value per input bar, aligned by index; bars
 * before there's enough history for a full window get `null` rather than
 * a partial/misleading average.
 *
 * Pulled out as a pure function (no chart library, no React) so it's
 * trivial to unit test and reusable outside the chart component.
 */
export function simpleMovingAverage(bars: PriceBar[], period: number): (number | null)[] {
  if (period <= 0) {
    throw new Error("period must be a positive integer");
  }

  const closes = bars.map((b) => b.close);
  const result: (number | null)[] = new Array(bars.length).fill(null);

  let windowSum = 0;
  for (let i = 0; i < closes.length; i++) {
    windowSum += closes[i]!;
    if (i >= period) {
      windowSum -= closes[i - period]!;
    }
    if (i >= period - 1) {
      result[i] = windowSum / period;
    }
  }

  return result;
}
