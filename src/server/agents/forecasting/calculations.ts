/**
 * Deterministic forecast arithmetic -- "Perform this calculation
 * deterministically in backend code rather than relying on the LLM to
 * perform the arithmetic." The AI supplies each scenario's judgment
 * (price target, probability, narrative); everything in this file is
 * plain math applied to those numbers afterward. Zero AI involvement.
 */

export interface RawScenarioNumbers {
  priceTarget: number;
  probabilityPct: number;
}

export interface NormalizedScenarioNumbers {
  bear: RawScenarioNumbers;
  base: RawScenarioNumbers;
  bull: RawScenarioNumbers;
}

/**
 * Forces bear+base+bull probabilities to sum to EXACTLY 100 -- "The
 * probabilities MUST total exactly 100%." The AI's raw probabilities are
 * proportionally rescaled and rounded to whole percentages, then any
 * ±1 rounding remainder is applied to whichever scenario has the largest
 * share, so the three values always sum to exactly 100 regardless of
 * what the AI produced.
 */
export function normalizeProbabilities(
  bearPct: number,
  basePct: number,
  bullPct: number
): { bear: number; base: number; bull: number } {
  const total = bearPct + basePct + bullPct;
  if (total <= 0) {
    // Degenerate input -- fall back to an even split rather than dividing by zero.
    return { bear: 34, base: 33, bull: 33 };
  }

  const scaled = {
    bear: (bearPct / total) * 100,
    base: (basePct / total) * 100,
    bull: (bullPct / total) * 100,
  };

  const rounded = {
    bear: Math.round(scaled.bear),
    base: Math.round(scaled.base),
    bull: Math.round(scaled.bull),
  };

  const roundedTotal = rounded.bear + rounded.base + rounded.bull;
  const remainder = 100 - roundedTotal;

  if (remainder !== 0) {
    // Apply the rounding remainder to whichever scenario has the largest
    // share, so the adjustment is proportionally least noticeable.
    const largest = (Object.keys(scaled) as (keyof typeof scaled)[]).reduce((a, b) =>
      scaled[a] >= scaled[b] ? a : b
    );
    rounded[largest] += remainder;
  }

  return rounded;
}

/**
 * Probability-weighted average of the three scenario prices --
 * Expected Price = (BearProb × BearPrice) + (BaseProb × BasePrice) + (BullProb × BullPrice).
 * Takes ALREADY-normalized probabilities (summing to exactly 100) so the
 * result is deterministic and reproducible from the displayed numbers.
 */
export function computeExpectedPrice(scenarios: NormalizedScenarioNumbers): number {
  const weighted =
    (scenarios.bear.probabilityPct / 100) * scenarios.bear.priceTarget +
    (scenarios.base.probabilityPct / 100) * scenarios.base.priceTarget +
    (scenarios.bull.probabilityPct / 100) * scenarios.bull.priceTarget;
  return weighted;
}

/** Expected Return = (Expected Price - Current Price) / Current Price. */
export function computeExpectedReturnPct(expectedPrice: number, currentPrice: number): number {
  if (currentPrice <= 0) return 0;
  return ((expectedPrice - currentPrice) / currentPrice) * 100;
}

/**
 * "No False Precision" -- rounds a price so the app never implies more
 * accuracy than a forecast can support. Enforced structurally here
 * rather than trusted to the AI's own rounding.
 *
 * Increments are sized so the worst-case rounding error stays around a
 * quarter of a percent or less at every price level. Two earlier
 * versions got this wrong in instructive ways:
 *   - A flat $0.50 step below $20 was 0.3% on a $150 stock but up to
 *     8.8% on a $2.83 one (a BBAI forecast of $2.83 stored as $3.00).
 *   - A $0.50 step for $20-$100 was fine for 12-month forecasts but too
 *     coarse once 1-week horizons existed: a CAVA 1-week range spanned
 *     only about +/-6%, so a 0.5% rounding step was a meaningful slice
 *     of the entire forecast.
 * These rounded figures are stored in prediction records, so coarse
 * rounding also quietly worsens measured accuracy, not just display.
 *
 * Note: this only rounds what is shown and stored as a target price.
 * Returns are computed from unrounded values (see forecasting/service.ts)
 * so rounding never compounds into the headline percentage.
 */
export function roundPriceForDisplay(price: number): number {
  if (price <= 0) return 0;
  if (price < 10) return Math.round(price * 100) / 100; // nearest $0.01
  if (price < 100) return Math.round(price * 20) / 20; // nearest $0.05
  if (price < 1000) return Math.round(price * 2) / 2; // nearest $0.50
  return Math.round(price); // nearest $1
}

export function roundReturnPct(pct: number): number {
  return Math.round(pct * 10) / 10; // nearest 0.1%
}
