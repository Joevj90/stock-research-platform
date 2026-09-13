import type { PriceBar } from "@/lib/types";
import { relativeStrengthIndex } from "@/lib/technical-indicators";

/**
 * Chart-pattern detection: the "things traders look at on a chart" that
 * the existing Technical Analysis agent (Step 4) does NOT cover, because
 * that agent only computes indicator VALUES (RSI, MACD, moving averages)
 * and never looks at candle SHAPE or multi-bar structure.
 *
 * Everything here is computed deterministically in code from real OHLC
 * bars. No LLM is involved at any point, by design: a candlestick
 * pattern has an exact definition, so asking a model to "spot" one would
 * introduce hallucination risk for zero benefit. Same principle the rest
 * of this app follows -- calculation in code, interpretation by AI.
 *
 * IMPORTANT, and the reason the backtest module next to this file
 * exists: detecting a pattern says nothing about whether that pattern
 * PREDICTS anything. Classical candlestick patterns are widely taught
 * and weakly evidenced. Nothing in this file should be treated as a
 * trading signal until `backtest.ts` has measured it against a naive
 * baseline on real historical bars.
 */

export type PatternDirection = "bullish" | "bearish";

export interface DetectedPattern {
  /** Stable machine key, used to group results in the backtest. */
  key: string;
  /** Human label shown in the UI. */
  name: string;
  direction: PatternDirection;
  /** Index into the bars array of the bar where the pattern COMPLETED.
   * Forward-return measurement always starts from this bar's close, so a
   * pattern can never peek at data it wouldn't have had in real time. */
  barIndex: number;
  timestamp: string;
  /** 0..1, a deterministic measure of how pronounced this instance is
   * (e.g. how completely one candle engulfs the previous). NOT a
   * confidence that the pattern will work -- that is what the backtest
   * measures. */
  strength: number;
  description: string;
}

interface CandleAnatomy {
  body: number;
  upperShadow: number;
  lowerShadow: number;
  range: number;
  isBullish: boolean;
}

function anatomy(bar: PriceBar): CandleAnatomy {
  const body = Math.abs(bar.close - bar.open);
  const upperShadow = bar.high - Math.max(bar.open, bar.close);
  const lowerShadow = Math.min(bar.open, bar.close) - bar.low;
  const range = bar.high - bar.low;
  return { body, upperShadow, lowerShadow, range, isBullish: bar.close > bar.open };
}

/** Short-run direction leading INTO a bar, used to qualify reversal
 * patterns (a hammer only means anything after a decline). Returns the
 * percentage change over the preceding `lookback` bars, or null if there
 * isn't enough history. */
function priorTrendPct(bars: PriceBar[], index: number, lookback = 5): number | null {
  const start = index - lookback;
  if (start < 0) return null;
  const from = bars[start]!.close;
  const to = bars[index - 1]?.close;
  if (to === undefined || from === 0) return null;
  return ((to - from) / from) * 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Bullish/bearish engulfing: a candle whose body completely covers the
 * previous candle's body, in the opposite direction. Strength is how
 * much larger the engulfing body is than the one it covers.
 */
export function detectEngulfing(bars: PriceBar[]): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    const a = anatomy(cur);
    const p = anatomy(prev);
    if (p.body === 0 || a.body === 0) continue;

    const prevTop = Math.max(prev.open, prev.close);
    const prevBottom = Math.min(prev.open, prev.close);
    const curTop = Math.max(cur.open, cur.close);
    const curBottom = Math.min(cur.open, cur.close);

    const engulfs = curTop >= prevTop && curBottom <= prevBottom;
    if (!engulfs) continue;
    if (a.isBullish === p.isBullish) continue; // must reverse direction

    const strength = clamp01((a.body / p.body - 1) / 2);
    out.push({
      key: a.isBullish ? "bullish_engulfing" : "bearish_engulfing",
      name: a.isBullish ? "Bullish engulfing" : "Bearish engulfing",
      direction: a.isBullish ? "bullish" : "bearish",
      barIndex: i,
      timestamp: cur.timestamp,
      strength,
      description: a.isBullish
        ? "An up candle completely covered the previous down candle, which traders read as buyers taking over."
        : "A down candle completely covered the previous up candle, which traders read as sellers taking over.",
    });
  }
  return out;
}

/**
 * Hammer (after a decline) and shooting star (after a rise): a small
 * body with one long shadow, meaning price moved far one way during the
 * bar and was pushed back before it closed.
 */
export function detectHammerAndStar(bars: PriceBar[]): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const a = anatomy(bar);
    if (a.range === 0 || a.body === 0) continue;

    const trend = priorTrendPct(bars, i);
    if (trend === null) continue;

    const isHammer = a.lowerShadow >= 2 * a.body && a.upperShadow <= a.body && trend < 0;
    const isStar = a.upperShadow >= 2 * a.body && a.lowerShadow <= a.body && trend > 0;
    if (!isHammer && !isStar) continue;

    const dominantShadow = isHammer ? a.lowerShadow : a.upperShadow;
    const strength = clamp01(dominantShadow / a.range);

    out.push({
      key: isHammer ? "hammer" : "shooting_star",
      name: isHammer ? "Hammer" : "Shooting star",
      direction: isHammer ? "bullish" : "bearish",
      barIndex: i,
      timestamp: bar.timestamp,
      strength,
      description: isHammer
        ? "After a decline, price dropped during the bar but buyers pushed it back up before the close."
        : "After a rise, price spiked during the bar but sellers pushed it back down before the close.",
    });
  }
  return out;
}

/**
 * Gaps: the bar opened entirely above the previous bar's high, or
 * entirely below its low. On intraday bars these are far rarer than on
 * daily bars and usually mark an overnight session boundary, which is
 * exactly why the backtest reports each pattern separately rather than
 * blending them.
 */
export function detectGaps(bars: PriceBar[], minGapPct = 0.2): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    if (prev.close === 0) continue;

    const gapUp = cur.open > prev.high;
    const gapDown = cur.open < prev.low;
    if (!gapUp && !gapDown) continue;

    const gapPct = Math.abs((cur.open - prev.close) / prev.close) * 100;
    if (gapPct < minGapPct) continue;

    out.push({
      key: gapUp ? "gap_up" : "gap_down",
      name: gapUp ? "Gap up" : "Gap down",
      direction: gapUp ? "bullish" : "bearish",
      barIndex: i,
      timestamp: cur.timestamp,
      strength: clamp01(gapPct / 2),
      description: gapUp
        ? "Price opened above the whole previous bar, meaning buyers stepped in with no trading in between."
        : "Price opened below the whole previous bar, meaning sellers stepped in with no trading in between.",
    });
  }
  return out;
}

/**
 * RSI divergence: price makes a higher high while RSI makes a lower high
 * (bearish), or price makes a lower low while RSI makes a higher low
 * (bullish). This is one of the more commonly cited chart signals, and
 * it needs the indicator series rather than just candle shape, which is
 * why it lives here rather than with the pure candlestick detectors.
 */
export function detectRsiDivergence(bars: PriceBar[], lookback = 20, rsiPeriod = 14): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const rsi = relativeStrengthIndex(bars, rsiPeriod);

  for (let i = lookback; i < bars.length; i++) {
    const windowStart = i - lookback;
    const curClose = bars[i]!.close;
    const curRsi = rsi[i];
    if (curRsi === null || curRsi === undefined) continue;

    // Find the extreme within the prior window (excluding the current bar).
    let priorHighIdx = windowStart;
    let priorLowIdx = windowStart;
    for (let j = windowStart; j < i; j++) {
      if (bars[j]!.close > bars[priorHighIdx]!.close) priorHighIdx = j;
      if (bars[j]!.close < bars[priorLowIdx]!.close) priorLowIdx = j;
    }

    const priorHighRsi = rsi[priorHighIdx];
    const priorLowRsi = rsi[priorLowIdx];

    if (priorHighRsi !== null && priorHighRsi !== undefined) {
      const higherHigh = curClose > bars[priorHighIdx]!.close;
      const weakerRsi = curRsi < priorHighRsi;
      if (higherHigh && weakerRsi) {
        out.push({
          key: "bearish_rsi_divergence",
          name: "Bearish RSI divergence",
          direction: "bearish",
          barIndex: i,
          timestamp: bars[i]!.timestamp,
          strength: clamp01((priorHighRsi - curRsi) / 20),
          description:
            "Price reached a new high but momentum did not, which traders read as the move running out of strength.",
        });
        continue;
      }
    }

    if (priorLowRsi !== null && priorLowRsi !== undefined) {
      const lowerLow = curClose < bars[priorLowIdx]!.close;
      const strongerRsi = curRsi > priorLowRsi;
      if (lowerLow && strongerRsi) {
        out.push({
          key: "bullish_rsi_divergence",
          name: "Bullish RSI divergence",
          direction: "bullish",
          barIndex: i,
          timestamp: bars[i]!.timestamp,
          strength: clamp01((curRsi - priorLowRsi) / 20),
          description:
            "Price reached a new low but momentum did not, which traders read as selling pressure fading.",
        });
      }
    }
  }
  return out;
}

/**
 * Least-squares slope of closing prices over the whole array, expressed
 * as percent change per bar. This is the numeric version of the diagonal
 * trendline a trader would draw by hand -- the existing Technical
 * Analysis agent only finds HORIZONTAL support/resistance, so slope was
 * a genuine gap.
 */
export function trendlineSlopePctPerBar(bars: PriceBar[]): number | null {
  const n = bars.length;
  if (n < 2) return null;

  const meanX = (n - 1) / 2;
  const meanY = bars.reduce((sum, b) => sum + b.close, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (bars[i]!.close - meanY);
    denominator += (i - meanX) ** 2;
  }
  if (denominator === 0 || meanY === 0) return null;

  const slopePerBar = numerator / denominator;
  return (slopePerBar / meanY) * 100;
}

/** Runs every detector and returns all hits sorted by bar index. */
export function detectAllPatterns(bars: PriceBar[]): DetectedPattern[] {
  return [
    ...detectEngulfing(bars),
    ...detectHammerAndStar(bars),
    ...detectGaps(bars),
    ...detectRsiDivergence(bars),
  ].sort((a, b) => a.barIndex - b.barIndex);
}
