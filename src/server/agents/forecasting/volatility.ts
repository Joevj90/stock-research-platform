/**
 * Turns the technical module's real volatility measurements into a
 * minimum bear-to-bull width for each forecast horizon. Pure arithmetic,
 * no AI involvement -- same rule as the rest of `calculations.ts`: the
 * model supplies judgment, code supplies the math.
 *
 * WHY THIS EXISTS. Measured against 75 resolved predictions (export of
 * 2026-10-16), the 1-week forecasts were drastically overconfident about
 * how still a stock sits:
 *
 *   predicted median move   0.50%      actual median move   5.63%
 *   predicted mean move     1.02%      actual mean move     6.50%
 *   actual move exceeded the predicted move in 89% of cases
 *   66% of outcomes landed OUTSIDE the stated bear..bull range
 *       (average range width: 9.5%)
 *
 * A range that misses two times in three is not a range. Two causes,
 * both fixed together:
 *
 *   1. The forecaster was never told how much the stock moves. The
 *      shared analysis summary passed the technical module's words
 *      ("trend: bullish", "momentum: strong") and its 0-100 score, but
 *      stripped every number -- no ATR, no realized volatility. It was
 *      being asked for a price range with no sense of scale.
 *   2. The prompt actively told it to keep short-horizon ranges
 *      "meaningfully narrower than the 3-month range", which is exactly
 *      backwards as a statement about width: a week of trading has less
 *      *expected drift* than three months, but the uncertainty around it
 *      does not shrink proportionally -- it shrinks with the square root
 *      of time, so a 1-week range should be roughly 1/3.5 of a 3-month
 *      range, not the token-narrow band the model was producing.
 *
 * Both are addressed. The numbers now reach the model (see
 * `analysis-summaries.ts`), and whatever it returns, the floor below is
 * applied in code afterwards so the guarantee does not depend on the
 * model having listened.
 *
 * WHAT THIS DOES NOT DO. It makes the stated uncertainty honest. It does
 * NOT make the direction call better -- 1-week direction measured 43.8%
 * correct against a 70.3% baseline, and nothing in this file changes
 * that. Widening a range around a coin-flip produces an honest coin-flip,
 * not a signal.
 */

import type { ForecastHorizonKey } from "@/lib/forecast-types";

/** Trading days, not calendar days: volatility accumulates only on days
 * the market is open. 252 trading days a year is the standard figure. */
export const TRADING_DAYS_PER_YEAR = 252;

export const TRADING_DAYS_BY_HORIZON: Record<ForecastHorizonKey, number> = {
  "1_week": 5,
  "1_month": 21,
  "3_month": 63,
  "6_month": 126,
  "12_month": TRADING_DAYS_PER_YEAR,
};

/**
 * How many standard deviations wide the bear-to-bull range must be, at
 * minimum. 2.5 means +/-1.25 sigma around the base case, which under a
 * normal distribution contains about 79% of outcomes -- so roughly one
 * forecast in five should land outside its range, which is what a
 * meaningful range looks like.
 *
 * Real stock returns have fatter tails than a normal distribution, so
 * the realised containment will be somewhat worse than 79%. The
 * honest expectation for the next batch of resolved predictions is an
 * outside-the-range rate falling from 66% to somewhere near 25-35%, not
 * to exactly 21%. If it lands far outside that, this constant is the
 * dial to turn -- and the prediction export is how we will know.
 */
export const MIN_RANGE_SIGMAS = 2.5;

/** Daily volatility is clamped into this band before use. A stock
 * showing 0.05%/day is almost certainly a data artefact (a stale or
 * thinly-traded series), and one showing 30%/day would generate a range
 * so wide it tells the reader nothing. Clamping keeps a bad input from
 * producing an absurd range. */
const MIN_DAILY_VOL_PCT = 0.25;
const MAX_DAILY_VOL_PCT = 12;

/**
 * ATR is an average true *range* (high to low, including overnight
 * gaps), not a standard deviation of closes, so it cannot be used as
 * sigma directly. For a random walk the expected high-low range over a
 * period is about 1.6 standard deviations, and this divisor converts in
 * that direction. It is an approximation and only used as a fallback
 * when the technical module could not produce a realized-volatility
 * figure.
 */
const ATR_RANGE_TO_SIGMA = 1.6;

export interface VolatilityInputs {
  /** Annualized realized volatility, percent, from the technical module. */
  volatilityAnnualizedPct: number | null;
  /** ATR(14) expressed as a percent of current price. */
  atrPct: number | null;
}

/**
 * One daily sigma, in percent. Prefers realized volatility (already a
 * standard deviation of returns) and falls back to the ATR conversion
 * above. Returns null when neither measurement is available -- in that
 * case no floor is applied at all, because inventing a volatility figure
 * would be worse than leaving the model's own range alone.
 */
export function dailyVolatilityPct(inputs: VolatilityInputs): number | null {
  const { volatilityAnnualizedPct, atrPct } = inputs;

  let daily: number | null = null;
  if (volatilityAnnualizedPct !== null && volatilityAnnualizedPct > 0) {
    daily = volatilityAnnualizedPct / Math.sqrt(TRADING_DAYS_PER_YEAR);
  } else if (atrPct !== null && atrPct > 0) {
    daily = atrPct / ATR_RANGE_TO_SIGMA;
  }

  if (daily === null || !Number.isFinite(daily)) return null;
  return Math.min(MAX_DAILY_VOL_PCT, Math.max(MIN_DAILY_VOL_PCT, daily));
}

/**
 * Scales one daily sigma out to a horizon by the square root of time --
 * sigma_h = sigma_daily * sqrt(trading days). This is why a 1-week range
 * is not one twelfth of a 3-month range: sqrt(5)/sqrt(63) is about 0.28,
 * not 0.08.
 */
export function horizonVolatilityPct(dailyPct: number, horizon: ForecastHorizonKey): number {
  return dailyPct * Math.sqrt(TRADING_DAYS_BY_HORIZON[horizon]);
}

/**
 * The move size a reader should consider ordinary over this horizon --
 * one sigma, rounded for display. This is the figure handed to the
 * forecaster so it has a scale to anchor on, and it is what the measured
 * data says was missing: the model was predicting ~1% weekly moves for
 * stocks that really move ~6.5%.
 */
export function typicalMovePct(inputs: VolatilityInputs, horizon: ForecastHorizonKey): number | null {
  const daily = dailyVolatilityPct(inputs);
  if (daily === null) return null;
  return Math.round(horizonVolatilityPct(daily, horizon) * 10) / 10;
}

/** Typical move for every horizon at once, for the interpreter input. */
export function typicalMoveByHorizonPct(
  inputs: VolatilityInputs
): Record<ForecastHorizonKey, number> | null {
  const daily = dailyVolatilityPct(inputs);
  if (daily === null) return null;

  const out = {} as Record<ForecastHorizonKey, number>;
  for (const horizon of Object.keys(TRADING_DAYS_BY_HORIZON) as ForecastHorizonKey[]) {
    out[horizon] = Math.round(horizonVolatilityPct(daily, horizon) * 10) / 10;
  }
  return out;
}

export interface ScenarioPrices {
  bear: number;
  base: number;
  bull: number;
}

export interface WidenedRange extends ScenarioPrices {
  /** True when the floor actually moved the tails, so callers (and
   * tests) can tell a widened range from one the model got right. */
  wasWidened: boolean;
  /** The floor that was applied, as a percent of current price. Null
   * when no volatility data was available and nothing was enforced. */
  minWidthPct: number | null;
}

/**
 * Pushes the bear and bull targets apart until the range is at least
 * `MIN_RANGE_SIGMAS` wide, leaving the base case exactly where the model
 * put it.
 *
 * Leaving base untouched is deliberate. The base target is the
 * directional call, and this function is about uncertainty, not
 * direction -- it must never quietly turn a flat call into a bullish one.
 * Only the tails move.
 *
 * The extra width is split between the two sides in proportion to how
 * the model already weighted them, so a forecast that saw more downside
 * room keeps that shape. The split is clamped to 25/75 either way: a
 * model that put its base case almost on top of its bear case would
 * otherwise have the entire widening land on the bull side, which would
 * turn a widening into a directional bet -- the exact thing the previous
 * paragraph rules out.
 */
export function widenRangeToVolatility(args: {
  scenarios: ScenarioPrices;
  currentPrice: number;
  horizon: ForecastHorizonKey;
  volatility: VolatilityInputs;
}): WidenedRange {
  const { scenarios, currentPrice, horizon, volatility } = args;
  const { bear, base, bull } = scenarios;

  const daily = dailyVolatilityPct(volatility);
  if (daily === null || currentPrice <= 0) {
    // No volatility measurement: leave the model's range exactly as it
    // is rather than enforcing a made-up floor.
    return { bear, base, bull, wasWidened: false, minWidthPct: null };
  }

  const minWidthPct = MIN_RANGE_SIGMAS * horizonVolatilityPct(daily, horizon);
  const minWidth = (currentPrice * minWidthPct) / 100;
  const currentWidth = bull - bear;

  if (currentWidth >= minWidth) {
    return { bear, base, bull, wasWidened: false, minWidthPct };
  }

  const deficit = minWidth - currentWidth;

  const lowerSide = Math.max(base - bear, 0);
  const upperSide = Math.max(bull - base, 0);
  const totalSides = lowerSide + upperSide;
  const rawLowerFraction = totalSides > 0 ? lowerSide / totalSides : 0.5;
  const lowerFraction = Math.min(0.75, Math.max(0.25, rawLowerFraction));

  // A price can approach zero but never pass it, so the bear target is
  // floored at 1% of the current price rather than allowed to go
  // negative on a very volatile stock at a long horizon.
  const widenedBear = Math.max(bear - deficit * lowerFraction, currentPrice * 0.01);
  const widenedBull = bull + deficit * (1 - lowerFraction);

  return {
    bear: Math.min(widenedBear, base),
    base,
    bull: Math.max(widenedBull, base),
    wasWidened: true,
    minWidthPct,
  };
}
