/**
 * The Trend Reset strategy rules, as plain arithmetic.
 *
 * No AI. Every number here is computed from price bars, exactly as the
 * offline backtest computed them -- the constants below are the same
 * values the backtest ran with, and they must stay that way. If a
 * threshold is changed here without re-running the backtest, the app
 * starts showing signals for a rule nobody has tested, while still
 * displaying the old backtest's statistics next to them. That is the
 * specific failure this file's comments exist to prevent.
 *
 * WHAT THE BACKTEST FOUND (2008-2026, 493 S&P 500 stocks, 11,523 trades)
 * Measured against random stocks of similar volatility bought on the
 * same days -- the strictest baseline tested -- Trend Reset was ahead by
 * about 0.78% per trade over a roughly 36-trading-day hold, with a
 * clustered t-statistic of 2.89. It was positive in 16 of 19 calendar
 * years, and removing 2009 and 2020 made it slightly stronger, which
 * killed the obvious "it just catches crash rebounds" explanation.
 *
 * WHAT THE BACKTEST DID NOT ESTABLISH
 *   - Roughly half the edge came from about 5 of 213 months. It is real
 *     but lumpy, and most individual months are close to a coin flip.
 *   - The portfolio's 2.34-point annual advantage over the equal-weight
 *     index sits inside the 1-4 point range that survivorship bias alone
 *     could explain. The relative tests above largely escape that
 *     objection because both sides were drawn from the same surviving
 *     companies; the headline return figure does not.
 *   - More than half of individual trades lost money (win rate 38.9%,
 *     median trade -2.41%). The average is carried by a minority of
 *     large winners, so any use of this rule has to tolerate long runs
 *     of losses.
 * Anything in the UI that presents these signals must say so.
 */

import type { PriceBar } from "@/lib/types";

/** Changing any of these invalidates the backtest. See the file header. */
export const TREND_RESET_CONFIG = {
  /** Close must be above the 200-day simple moving average. */
  smaPeriod: 200,
  /** The 200-day SMA must be higher than it was this many days ago. */
  smaRisingLookback: 20,
  /** Rate-of-change window. */
  rocPeriod: 63,
  /** How far back to look for the "it was moving" phase. */
  elevatedLookback: 60,
  /** The highest 63-day ROC in that window must have reached this. */
  elevatedMinRocPct: 15,
  /** Current 63-day ROC must be inside +/- this band. */
  resetBandPct: 3,
} as const;

/** How much daily history the evaluation needs: the SMA window plus the
 * rising-SMA lookback is the deepest reach back. Fetching less silently
 * produces "not enough data" rather than a wrong answer, but there is no
 * reason to cut it fine. */
export const TREND_RESET_MIN_BARS = TREND_RESET_CONFIG.smaPeriod + TREND_RESET_CONFIG.smaRisingLookback;

export interface ConditionResult {
  /** Short label for the UI. */
  label: string;
  passed: boolean;
  /** What the stock actually did, in plain words with the number in it. */
  detail: string;
}

export interface TrendResetEvaluation {
  /** True only when all four conditions hold. */
  qualifies: boolean;
  conditions: ConditionResult[];
  /** Null when there was not enough history to judge. */
  currentPrice: number | null;
  sma200: number | null;
  /** Percent the price sits above (positive) or below (negative) the SMA. */
  pctAboveSma: number | null;
  roc63Pct: number | null;
  maxRoc63PriorPct: number | null;
  asOfDate: string | null;
  barsAvailable: number;
  /** Set when the evaluation could not be made at all. */
  insufficientData: boolean;
}

export function simpleMovingAverage(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rateOfChangePct(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const past = values[i - period]!;
    if (past > 0) out[i] = (values[i]! / past - 1) * 100;
  }
  return out;
}

/** Highest value across the `window` entries BEFORE index i -- the rule
 * says "over the prior 60 trading days", which excludes today. */
export function rollingMaxPrior(values: (number | null)[], window: number, at: number): number | null {
  const start = at - window;
  if (start < 0) return null;
  let max: number | null = null;
  for (let j = start; j < at; j++) {
    const v = values[j];
    if (v === null || v === undefined) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Evaluates the four Trend Reset conditions against the most recent bar.
 *
 * Bars must be oldest-first. Returns every condition individually, pass
 * or fail, because a watchlist that only said yes/no would hide the
 * interesting part -- a stock failing one condition by a hair is worth
 * seeing, and a stock failing three is not the same thing at all.
 */
export function evaluateTrendReset(bars: PriceBar[]): TrendResetEvaluation {
  const cfg = TREND_RESET_CONFIG;

  const empty: TrendResetEvaluation = {
    qualifies: false,
    conditions: [],
    currentPrice: null,
    sma200: null,
    pctAboveSma: null,
    roc63Pct: null,
    maxRoc63PriorPct: null,
    asOfDate: null,
    barsAvailable: bars.length,
    insufficientData: true,
  };

  if (bars.length < TREND_RESET_MIN_BARS) return empty;

  const closes = bars.map((b) => b.close);
  const last = bars.length - 1;

  const smaSeries = simpleMovingAverage(closes, cfg.smaPeriod);
  const rocSeries = rateOfChangePct(closes, cfg.rocPeriod);

  const sma = smaSeries[last];
  const smaPast = smaSeries[last - cfg.smaRisingLookback];
  const roc = rocSeries[last];
  const maxRocPrior = rollingMaxPrior(rocSeries, cfg.elevatedLookback, last);

  if (
    sma === null ||
    sma === undefined ||
    smaPast === null ||
    smaPast === undefined ||
    roc === null ||
    roc === undefined ||
    maxRocPrior === null
  ) {
    return empty;
  }

  const price = closes[last]!;
  const pctAboveSma = ((price - sma) / sma) * 100;
  const smaChangePct = ((sma - smaPast) / smaPast) * 100;

  const aboveSma = price > sma;
  const smaRising = sma > smaPast;
  const wasElevated = maxRocPrior >= cfg.elevatedMinRocPct;
  const hasReset = roc >= -cfg.resetBandPct && roc <= cfg.resetBandPct;

  const conditions: ConditionResult[] = [
    {
      label: `Price above the ${cfg.smaPeriod}-day average`,
      passed: aboveSma,
      detail: aboveSma
        ? `Yes — ${round(pctAboveSma, 1)}% above it`
        : `No — ${round(Math.abs(pctAboveSma), 1)}% below it`,
    },
    {
      label: `${cfg.smaPeriod}-day average is rising`,
      passed: smaRising,
      detail: smaRising
        ? `Yes — up ${round(smaChangePct, 1)}% over the last ${cfg.smaRisingLookback} trading days`
        : `No — down ${round(Math.abs(smaChangePct), 1)}% over the last ${cfg.smaRisingLookback} trading days`,
    },
    {
      label: `It was moving recently (peak ${cfg.rocPeriod}-day gain ≥ ${cfg.elevatedMinRocPct}%)`,
      passed: wasElevated,
      detail: wasElevated
        ? `Yes — peaked at ${round(maxRocPrior, 1)}% in the last ${cfg.elevatedLookback} days`
        : `No — only reached ${round(maxRocPrior, 1)}%, short of ${cfg.elevatedMinRocPct}%`,
    },
    {
      label: `It has gone quiet (${cfg.rocPeriod}-day change within ±${cfg.resetBandPct}%)`,
      passed: hasReset,
      detail: hasReset
        ? `Yes — currently ${roc >= 0 ? "+" : ""}${round(roc, 1)}%`
        : `No — currently ${roc >= 0 ? "+" : ""}${round(roc, 1)}%, outside the band`,
    },
  ];

  return {
    qualifies: conditions.every((c) => c.passed),
    conditions,
    currentPrice: round(price),
    sma200: round(sma),
    pctAboveSma: round(pctAboveSma, 1),
    roc63Pct: round(roc, 1),
    maxRoc63PriorPct: round(maxRocPrior, 1),
    asOfDate: bars[last]!.timestamp.slice(0, 10),
    barsAvailable: bars.length,
    insufficientData: false,
  };
}
