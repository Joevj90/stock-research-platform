import type { PriceBar } from "@/lib/types";
import { detectAllPatterns, type DetectedPattern, type PatternDirection } from "@/lib/chart-patterns";

/**
 * Measures whether the patterns in `chart-patterns.ts` actually predict
 * anything, by replaying them over real historical bars and checking
 * what happened next.
 *
 * The whole point of this module is that a hit rate on its own is
 * meaningless. If a stock rose over 54% of all windows in the sample,
 * then a bullish pattern that is "right 54% of the time" has found
 * nothing -- you'd have done exactly as well by always guessing up and
 * ignoring the chart entirely. So every result here is reported as an
 * EDGE over that naive baseline, never as a bare accuracy figure, and
 * with a standard error so a 2-sample fluke can't masquerade as a
 * finding.
 *
 * No lookahead: a pattern completing at bar i is evaluated from bar i's
 * CLOSE forward. Nothing in the detection path is allowed to see bars
 * after i (see DetectedPattern.barIndex).
 */

export interface PatternPerformance {
  key: string;
  name: string;
  direction: PatternDirection;
  /** How many times this pattern occurred with enough forward bars to
   * evaluate. Small numbers here mean the rest of the row is noise. */
  sampleSize: number;
  /** Fraction of occurrences where price moved the way the pattern
   * implied, 0..1. */
  hitRate: number;
  /** What you'd have scored by ALWAYS predicting this pattern's
   * direction on every bar in the sample, ignoring the chart. */
  baselineHitRate: number;
  /** hitRate - baselineHitRate. This is the only number that indicates
   * the pattern added information. Zero or negative means it did not. */
  edge: number;
  /** Standard error of hitRate. If |edge| is smaller than roughly twice
   * this, the result is indistinguishable from chance at this sample
   * size. */
  standardError: number;
  /** True when |edge| > 2 * standardError AND sampleSize >= 30. Both
   * conditions matter: a large edge on 4 samples is not a finding. */
  isStatisticallyMeaningful: boolean;
  /** Mean forward return in percent, signed in the pattern's favour
   * (positive = the pattern's direction was profitable on average). */
  averageFavourableReturnPct: number;
}

export interface BacktestResult {
  ticker: string;
  horizonBars: number;
  totalBars: number;
  /** Fraction of all evaluable bars whose forward return was positive.
   * This is the market drift in the sample and the reason bare hit rates
   * mislead. */
  upRateAllBars: number;
  patterns: PatternPerformance[];
  /** A second, harder baseline: predict that the last few bars' move
   * continues. Beating "always up" is easy in a rising market; beating
   * trend-continuation is the more meaningful test. */
  trendContinuationHitRate: number;
  trendContinuationSampleSize: number;
}

function forwardReturnPct(bars: PriceBar[], index: number, horizonBars: number): number | null {
  const from = bars[index]?.close;
  const to = bars[index + horizonBars]?.close;
  if (from === undefined || to === undefined || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Fraction of all evaluable bars whose forward return was positive. */
function computeUpRate(bars: PriceBar[], horizonBars: number): { upRate: number; evaluable: number } {
  let up = 0;
  let evaluable = 0;
  for (let i = 0; i < bars.length; i++) {
    const r = forwardReturnPct(bars, i, horizonBars);
    if (r === null) continue;
    evaluable++;
    if (r > 0) up++;
  }
  return { upRate: evaluable === 0 ? 0 : up / evaluable, evaluable };
}

/**
 * Baseline 2: at each bar, predict that the direction of the previous
 * `lookback` bars continues. This is the "momentum, but with no chart
 * reading at all" comparison -- the bar a pattern has to clear to be
 * worth computing.
 */
function computeTrendContinuation(
  bars: PriceBar[],
  horizonBars: number,
  lookback = 5
): { hitRate: number; sampleSize: number } {
  let correct = 0;
  let total = 0;
  for (let i = lookback; i < bars.length; i++) {
    const past = bars[i - lookback]?.close;
    const now = bars[i]?.close;
    if (past === undefined || now === undefined || past === 0) continue;
    const priorMove = now - past;
    if (priorMove === 0) continue;

    const fwd = forwardReturnPct(bars, i, horizonBars);
    if (fwd === null || fwd === 0) continue;

    total++;
    const predictedUp = priorMove > 0;
    if (predictedUp === fwd > 0) correct++;
  }
  return { hitRate: total === 0 ? 0 : correct / total, sampleSize: total };
}

function summarise(
  group: DetectedPattern[],
  bars: PriceBar[],
  horizonBars: number,
  upRateAllBars: number
): PatternPerformance | null {
  const first = group[0];
  if (!first) return null;

  let correct = 0;
  let total = 0;
  let favourableSum = 0;

  for (const p of group) {
    const fwd = forwardReturnPct(bars, p.barIndex, horizonBars);
    if (fwd === null || fwd === 0) continue;
    total++;
    const wentUp = fwd > 0;
    const predictedUp = p.direction === "bullish";
    if (wentUp === predictedUp) correct++;
    // Signed so positive always means "the pattern's direction paid".
    favourableSum += predictedUp ? fwd : -fwd;
  }

  if (total === 0) return null;

  const hitRate = correct / total;
  // A bullish pattern must beat "always guess up"; a bearish one must
  // beat "always guess down", which is the complement.
  const baselineHitRate = first.direction === "bullish" ? upRateAllBars : 1 - upRateAllBars;
  const edge = hitRate - baselineHitRate;
  const standardError = Math.sqrt((hitRate * (1 - hitRate)) / total);

  return {
    key: first.key,
    name: first.name,
    direction: first.direction,
    sampleSize: total,
    hitRate,
    baselineHitRate,
    edge,
    standardError,
    isStatisticallyMeaningful: total >= 30 && Math.abs(edge) > 2 * standardError,
    averageFavourableReturnPct: favourableSum / total,
  };
}

/**
 * Replays every pattern over `bars` and reports how each performed over
 * the next `horizonBars` bars, against both naive baselines.
 *
 * `horizonBars` is in BARS, not days -- with 5-minute intraday bars, one
 * trading day is about 78 bars, so a 1-to-7-day horizon is roughly 78 to
 * 546 bars. The caller decides, since it knows the bar interval.
 */
export function backtestPatterns(
  ticker: string,
  bars: PriceBar[],
  horizonBars: number
): BacktestResult {
  const detected = detectAllPatterns(bars);
  const { upRate } = computeUpRate(bars, horizonBars);
  const trend = computeTrendContinuation(bars, horizonBars);

  const byKey = new Map<string, DetectedPattern[]>();
  for (const p of detected) {
    const existing = byKey.get(p.key);
    if (existing) existing.push(p);
    else byKey.set(p.key, [p]);
  }

  const patterns: PatternPerformance[] = [];
  for (const group of byKey.values()) {
    const summary = summarise(group, bars, horizonBars, upRate);
    if (summary) patterns.push(summary);
  }

  // Strongest genuine edge first, but meaningful results always outrank
  // large-but-unproven ones so the table can't be read the wrong way.
  patterns.sort((a, b) => {
    if (a.isStatisticallyMeaningful !== b.isStatisticallyMeaningful) {
      return a.isStatisticallyMeaningful ? -1 : 1;
    }
    return b.edge - a.edge;
  });

  return {
    ticker,
    horizonBars,
    totalBars: bars.length,
    upRateAllBars: upRate,
    patterns,
    trendContinuationHitRate: trend.hitRate,
    trendContinuationSampleSize: trend.sampleSize,
  };
}
