import type { PriceBar } from "@/lib/types";

/**
 * Pure, deterministic technical-indicator calculations. Every function
 * here takes only real PriceBar[] (from the market-data service — never
 * fabricated) and returns numbers derived by standard, well-known
 * formulas — no AI involved anywhere in this file. This is what the
 * Technical Analysis Agent's "calculated" output is built from; the
 * agent's AI layer (see src/server/agents/technical-analysis) only
 * interprets these numbers, it never computes them.
 *
 * Arrays are aligned to the input bars by index; positions without enough
 * history for a full window are `null` rather than a misleading partial
 * value. Being pure functions (no React, no chart library, no network),
 * they're used by both the client-side chart and the server-side agent,
 * and are trivial to unit test in isolation.
 */

export function simpleMovingAverage(bars: PriceBar[], period: number): (number | null)[] {
  requirePositivePeriod(period);
  const closes = bars.map((b) => b.close);
  const result: (number | null)[] = new Array(bars.length).fill(null);

  let windowSum = 0;
  for (let i = 0; i < closes.length; i++) {
    windowSum += closes[i]!;
    if (i >= period) windowSum -= closes[i - period]!;
    if (i >= period - 1) result[i] = windowSum / period;
  }
  return result;
}

/** Exponential moving average, seeded with an SMA of the first `period`
 * closes (the standard convention). */
export function exponentialMovingAverage(bars: PriceBar[], period: number): (number | null)[] {
  requirePositivePeriod(period);
  const closes = bars.map((b) => b.close);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (closes.length < period) return result;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i]!;
  seed /= period;
  result[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < closes.length; i++) {
    const value = closes[i]! * k + prev * (1 - k);
    result[i] = value;
    prev = value;
  }
  return result;
}

/** Wilder's RSI (the standard 14-period formulation). */
export function relativeStrengthIndex(bars: PriceBar[], period = 14): (number | null)[] {
  requirePositivePeriod(period);
  const closes = bars.map((b) => b.close);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return result;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  line: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/** Standard MACD(12,26,9): fast EMA minus slow EMA, with a 9-period EMA
 * of the MACD line itself as the signal line. */
export function macd(bars: PriceBar[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = exponentialMovingAverage(bars, fast);
  const emaSlow = exponentialMovingAverage(bars, slow);

  const line: (number | null)[] = bars.map((_, i) => {
    const f = emaFast[i] ?? null;
    const s = emaSlow[i] ?? null;
    return f !== null && s !== null ? f - s : null;
  });

  // EMA of the MACD line, starting from the first index where `line` has
  // `signalPeriod` consecutive non-null values.
  const signal: (number | null)[] = new Array(bars.length).fill(null);
  const firstValidIdx = line.findIndex((v) => v !== null);
  if (firstValidIdx !== -1 && bars.length - firstValidIdx >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let seed = 0;
    for (let i = firstValidIdx; i < firstValidIdx + signalPeriod; i++) seed += line[i]!;
    seed /= signalPeriod;
    const seedIdx = firstValidIdx + signalPeriod - 1;
    signal[seedIdx] = seed;

    let prev = seed;
    for (let i = seedIdx + 1; i < bars.length; i++) {
      const value = line[i]! * k + prev * (1 - k);
      signal[i] = value;
      prev = value;
    }
  }

  const histogram: (number | null)[] = bars.map((_, i) => {
    const l = line[i] ?? null;
    const s = signal[i] ?? null;
    return l !== null && s !== null ? l - s : null;
  });

  return { line, signal, histogram };
}

export interface BollingerBandsResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

/** Bollinger Bands: SMA middle band, ±`stdDevMultiplier` population
 * standard deviations of closes over the same window. */
export function bollingerBands(
  bars: PriceBar[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsResult {
  requirePositivePeriod(period);
  const closes = bars.map((b) => b.close);
  const middle = simpleMovingAverage(bars, period);
  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i]!;
    let sumSquaredDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSquaredDiff += (closes[j]! - mean) ** 2;
    }
    const stdDev = Math.sqrt(sumSquaredDiff / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { upper, middle, lower };
}

/** Wilder's Average True Range (14-period standard). */
export function averageTrueRange(bars: PriceBar[], period = 14): (number | null)[] {
  requirePositivePeriod(period);
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return result;

  const trueRanges: number[] = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prevClose = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  });

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i]!;
  let atr = sum / period;
  result[period] = atr;

  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
    result[i] = atr;
  }
  return result;
}

export interface VolumeTrend {
  latestVolume: number;
  averageVolume: number | null;
  ratio: number | null;
}

/** Latest volume vs. its own trailing average — purely numeric, no
 * "surging"/"quiet" labeling (that framing belongs to the AI
 * interpretation layer, not this calculation layer). */
export function volumeTrend(bars: PriceBar[], period = 20): VolumeTrend {
  const latestVolume = bars.length > 0 ? bars[bars.length - 1]!.volume : 0;
  if (bars.length < period) {
    return { latestVolume, averageVolume: null, ratio: null };
  }
  const window = bars.slice(bars.length - period);
  const averageVolume = window.reduce((sum, b) => sum + b.volume, 0) / period;
  return {
    latestVolume,
    averageVolume,
    ratio: averageVolume > 0 ? latestVolume / averageVolume : null,
  };
}

/** Annualized volatility (%) from the standard deviation of daily
 * percentage returns over the trailing `period` bars. */
export function annualizedVolatility(bars: PriceBar[], period = 20): number | null {
  if (bars.length < period + 1) return null;

  const window = bars.slice(bars.length - period - 1);
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    returns.push((window[i]!.close - window[i - 1]!.close) / window[i - 1]!.close);
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const dailyStdDev = Math.sqrt(variance);
  return dailyStdDev * Math.sqrt(252) * 100; // annualized, as a percentage
}

/** Rate of change (%) over `period` bars — a standard momentum measure. */
export function rateOfChange(bars: PriceBar[], period = 10): number | null {
  if (bars.length <= period) return null;
  const current = bars[bars.length - 1]!.close;
  const past = bars[bars.length - 1 - period]!.close;
  if (past === 0) return null;
  return ((current - past) / past) * 100;
}

export interface SupportResistanceLevels {
  support: number[];
  resistance: number[];
}

/**
 * Detects swing-low / swing-high pivot points (a bar whose low/high is
 * the extreme within a `window`-bar neighborhood on both sides — the
 * standard "fractal" definition used in technical analysis), then returns
 * the up to 3 closest distinct support levels (below the current price)
 * and up to 3 closest resistance levels (above it), nearest first.
 */
export function detectSupportResistance(
  bars: PriceBar[],
  window = 5,
  maxLevels = 3
): SupportResistanceLevels {
  if (bars.length === 0) return { support: [], resistance: [] };

  const currentPrice = bars[bars.length - 1]!.close;
  const supportCandidates: number[] = [];
  const resistanceCandidates: number[] = [];

  for (let i = window; i < bars.length - window; i++) {
    const low = bars[i]!.low;
    const high = bars[i]!.high;

    let isSwingLow = true;
    let isSwingHigh = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (bars[j]!.low < low) isSwingLow = false;
      if (bars[j]!.high > high) isSwingHigh = false;
    }
    if (isSwingLow) supportCandidates.push(low);
    if (isSwingHigh) resistanceCandidates.push(high);
  }

  const support = dedupeNearby(supportCandidates.filter((p) => p < currentPrice))
    .sort((a, b) => currentPrice - a - (currentPrice - b))
    .slice(0, maxLevels)
    .sort((a, b) => b - a);

  const resistance = dedupeNearby(resistanceCandidates.filter((p) => p > currentPrice))
    .sort((a, b) => a - currentPrice - (b - currentPrice))
    .slice(0, maxLevels)
    .sort((a, b) => a - b);

  return { support, resistance };
}

/** Collapses price levels within 0.5% of each other into one (keeping the
 * first), so tightly clustered pivots don't produce near-duplicate levels. */
function dedupeNearby(levels: number[], toleranceFraction = 0.005): number[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const result: number[] = [];
  for (const level of sorted) {
    const last = result[result.length - 1];
    if (last === undefined || Math.abs(level - last) / last > toleranceFraction) {
      result.push(level);
    }
  }
  return result;
}

function requirePositivePeriod(period: number): void {
  if (period <= 0) {
    throw new Error("period must be a positive integer");
  }
}
