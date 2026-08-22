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
 * "No False Precision" -- rounds a price to a sensible number of
 * significant digits given typical stock-price magnitudes, so the app
 * never displays something like "$183.47" when the underlying
 * uncertainty is large. Enforced structurally here rather than trusted
 * to the AI's own rounding.
 */
export function roundPriceForDisplay(price: number): number {
  if (price <= 0) return 0;
  if (price < 20) return Math.round(price * 2) / 2; // nearest $0.50
  if (price < 200) return Math.round(price); // nearest $1
  if (price < 1000) return Math.round(price / 5) * 5; // nearest $5
  return Math.round(price / 10) * 10; // nearest $10
}

export function roundReturnPct(pct: number): number {
  return Math.round(pct * 10) / 10; // nearest 0.1%
}
