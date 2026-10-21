/**
 * Entry signals for the breakout backtest: Setups A, B and C.
 *
 * Signals are computed from price and volume alone, independent of
 * whether a position is open, so this whole file can be tested for
 * lookahead in isolation: the signals produced from the first n bars of
 * a series must equal the first n days of the signals produced from the
 * full series. signals.test.ts checks exactly that.
 *
 * A signal on day i is known at day i's CLOSE. The engine acts on it at
 * the next open at the earliest.
 */

import type { BreakoutConfig, LiquidityTier } from "./config";
import { type DailySeries, priorAverage, sma } from "./series";

export type SetupKind = "A" | "B" | "C";

export interface Signal {
  /** Bar index of the signal day (known at that day's close). */
  index: number;
  date: string;
  setup: SetupKind;
  /** Initial stop for a position opened from this signal. */
  stop: number;
  /** Price level the setup broke out over. Setup A's confirmation mode
   * cancels the entry if a close falls back below it. */
  pivot: number;
  tier: LiquidityTier;
  /** Signal-day volume / prior 20-day average volume. */
  volumeRatio: number;
  /** Setup A only: measured base length in trading days. */
  baseDays?: number;
  /** True if the stock held or rose while the index fell at least
   * `selloffMinDrawdown` in the lookback; false if it fell with it; null
   * if there was no selloff to measure against. */
  selloffStrength: boolean | null;
}

/** The index (SPY) closes, keyed by date, for the selloff test. */
export interface IndexContext {
  dates: string[];
  close: number[];
  indexByDate: Map<string, number>;
}

export function buildIndexContext(s: DailySeries): IndexContext {
  return { dates: s.dates, close: s.close, indexByDate: new Map(s.dates.map((d, i) => [d, i])) };
}

function liquidityTier(avgDollar50: number, cfg: BreakoutConfig): LiquidityTier {
  if (avgDollar50 >= cfg.largeTierDollarVolume) return "large";
  if (avgDollar50 >= cfg.midTierDollarVolume) return "mid";
  return "small";
}

function maxOf(a: number[], from: number, to: number): number {
  let m = -Infinity;
  for (let k = from; k <= to; k++) if (a[k]! > m) m = a[k]!;
  return m;
}
function minOf(a: number[], from: number, to: number): number {
  let m = Infinity;
  for (let k = from; k <= to; k++) if (a[k]! < m) m = a[k]!;
  return m;
}

/**
 * Strength during an index selloff, measured over the `lookback` trading
 * days of the index ending on `date`: find the index's highest close and
 * the lowest close after it. If that decline is at least `minDrawdown`,
 * report whether the stock's close on the trough date was at or above
 * its close on the peak date.
 */
export function selloffStrength(
  stockDates: Map<string, number>,
  stockClose: number[],
  index: IndexContext | null,
  date: string,
  lookback: number,
  minDrawdown: number,
): boolean | null {
  if (!index) return null;
  const j = index.indexByDate.get(date);
  if (j === undefined || j < lookback) return null;
  let peakIdx = j - lookback + 1;
  for (let k = peakIdx; k <= j; k++) if (index.close[k]! > index.close[peakIdx]!) peakIdx = k;
  let troughIdx = peakIdx;
  for (let k = peakIdx; k <= j; k++) if (index.close[k]! < index.close[troughIdx]!) troughIdx = k;
  const drawdown = index.close[troughIdx]! / index.close[peakIdx]! - 1;
  if (drawdown > -minDrawdown) return null;
  const sp = stockDates.get(index.dates[peakIdx]!);
  const st = stockDates.get(index.dates[troughIdx]!);
  if (sp === undefined || st === undefined) return null;
  return stockClose[st]! >= stockClose[sp]!;
}

export function isGovernanceExcluded(symbol: string, date: string, cfg: BreakoutConfig): boolean {
  return cfg.governanceExclusions.some((g) => g.symbol === symbol && date >= g.from);
}

/** Returns, for each bar, the signals that fired at that bar's close. */
export function computeSignals(s: DailySeries, cfg: BreakoutConfig, index: IndexContext | null): Signal[][] {
  const n = s.dates.length;
  const out: Signal[][] = Array.from({ length: n }, () => []);
  const { open, high, low, close, volume } = s;

  const dollar = close.map((c, i) => c * volume[i]!);
  const avgVol20 = priorAverage(volume, 20);
  const avgDollar20 = priorAverage(dollar, 20);
  const avgDollar50 = priorAverage(dollar, 50);
  const vol10 = sma(volume, 10);
  const sma50 = sma(close, 50);
  const dateIdx = new Map(s.dates.map((d, i) => [d, i]));

  const T = cfg.tightDays;
  const firstA = T + cfg.dryUpLookbackDays + 10;

  let breakout: { b: number; pivot: number; avgVolAtB: number } | null = null;
  let catalyst: { c: number; close: number; low: number; maxHigh: number; minLow: number; retested: boolean } | null =
    null;

  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(avgVol20[i]!) || !Number.isFinite(avgDollar50[i]!)) continue;
    const eligible =
      close[i]! >= cfg.minPrice &&
      avgDollar20[i]! >= cfg.minAvgDollarVolume &&
      !isGovernanceExcluded(s.symbol, s.dates[i]!, cfg);
    const tier = liquidityTier(avgDollar50[i]!, cfg);
    const volRatio = avgVol20[i]! > 0 ? volume[i]! / avgVol20[i]! : 0;
    let rsCache: boolean | null | undefined;
    const rs = () =>
      rsCache !== undefined
        ? rsCache
        : (rsCache = selloffStrength(dateIdx, close, index, s.dates[i]!, cfg.selloffLookbackDays, cfg.selloffMinDrawdown));
    const emit = (sig: Omit<Signal, "index" | "date" | "tier" | "volumeRatio" | "selloffStrength">) => {
      if (!eligible) return;
      const strength = rs();
      if (cfg.requireSelloffStrength && strength !== true) return;
      out[i]!.push({ ...sig, index: i, date: s.dates[i]!, tier, volumeRatio: volRatio, selloffStrength: strength });
    };

    // ---------- Setup B (uses the breakout recorded on an EARLIER day) ----------
    if (breakout) {
      const { b, pivot, avgVolAtB } = breakout;
      const age = i - b;
      if (age > cfg.pullbackMaxDays || close[i]! < pivot * (1 - cfg.pullbackMaxBreakPct)) {
        breakout = null;
      } else if (age >= cfg.pullbackMinDays) {
        let h = b;
        for (let k = b; k <= i - 1; k++) if (high[k]! >= high[h]!) h = k;
        const pullStart = h + 1;
        const pullEnd = i - 1;
        if (pullEnd - pullStart + 1 >= 2) {
          const pullLow = minOf(low, pullStart, pullEnd);
          const minCloseSince = minOf(close, b + 1, i - 1);
          let pullVol = 0;
          for (let k = pullStart; k <= pullEnd; k++) pullVol += volume[k]!;
          pullVol /= pullEnd - pullStart + 1;
          const ma = sma50[i - 1]!;
          const maRising = i >= 11 && Number.isFinite(sma50[i - 11]!) && ma > sma50[i - 11]!;
          const nearPivot = pullLow <= pivot * (1 + cfg.pullbackNearPct);
          const nearMa = Number.isFinite(ma) && maRising && pullLow <= ma * (1 + cfg.pullbackNearPct);
          const held = minCloseSince >= pivot * (1 - cfg.pullbackMaxBreakPct);
          const quiet = pullVol < avgVolAtB;
          const turn =
            close[i]! > high[i - 1]! &&
            close[i]! > pivot &&
            volume[i]! > volume[i - 1]! &&
            volume[i]! > pullVol * cfg.pullbackTurnVolumeMultiple;
          if (cfg.setupB && (nearPivot || nearMa) && held && quiet && turn) {
            emit({ setup: "B", stop: pullLow, pivot });
            breakout = null; // first pullback only
          }
        }
      }
    }

    // ---------- Setup A: tight base breakout ----------
    if (i >= firstA) {
      const pivot = maxOf(high, i - T, i - 1);
      const tightLow = minOf(low, i - T, i - 1);
      const tightOk = (pivot - tightLow) / pivot <= cfg.tightMaxRange;
      if (tightOk && close[i]! > pivot) {
        let L = T;
        for (let k = i - T - 1; k >= Math.max(0, i - cfg.baseMaxDays); k--) {
          if (high[k]! > pivot * (1 + cfg.baseHighTolerance)) break;
          L++;
        }
        const baseHigh = maxOf(high, i - L, i - 1);
        const baseLow = minOf(low, i - L, i - 1);
        const depthOk = (baseHigh - baseLow) / baseHigh <= cfg.baseMaxDepth;
        const minTight = minOf(vol10, i - T, i - 1);
        const priorFrom = i - T - cfg.dryUpLookbackDays;
        const minPrior = priorFrom >= 9 ? minOf(vol10, priorFrom, i - T - 1) : NaN;
        const dryUp = Number.isFinite(minPrior) && minTight <= minPrior * cfg.dryUpTolerance;
        const volOk = volRatio >= cfg.breakoutVolumeMultiple[tier];
        if (L >= cfg.baseMinDays && depthOk && dryUp && volOk) {
          // Record the breakout for Setup B even when Setup A is disabled
          // or the stock is ineligible today.
          breakout = { b: i, pivot, avgVolAtB: avgVol20[i]! };
          if (cfg.setupA) emit({ setup: "A", stop: minOf(low, i - 4, i), pivot, baseDays: L });
        }
      }
    }

    // ---------- Setup C: catalyst + volume ----------
    if (catalyst) {
      const age = i - catalyst.c;
      if (age > cfg.catalystWatchDays || close[i]! < catalyst.low) {
        catalyst = null;
      } else {
        if (low[i]! <= catalyst.close) catalyst.retested = true;
        catalyst.minLow = Math.min(catalyst.minLow, low[i]!);
        if (catalyst.retested && age >= cfg.catalystRetestMinDays && close[i]! > catalyst.maxHigh) {
          if (cfg.setupC) emit({ setup: "C", stop: catalyst.minLow, pivot: catalyst.maxHigh });
          catalyst = null;
        } else {
          catalyst.maxHigh = Math.max(catalyst.maxHigh, high[i]!);
        }
      }
    }
    const range = high[i]! - low[i]!;
    const gap = open[i]! / close[i - 1]! - 1;
    const dayGain = close[i]! / close[i - 1]! - 1;
    const isCatalyst =
      (gap >= cfg.catalystMinGap || dayGain >= cfg.catalystMinDayGain) &&
      volRatio >= cfg.catalystVolumeMultiple &&
      range > 0 &&
      (close[i]! - low[i]!) / range >= cfg.catalystMinCloseLocation;
    if (isCatalyst) {
      if (cfg.catalystEntry === "immediate") {
        if (cfg.setupC) emit({ setup: "C", stop: low[i]!, pivot: high[i]! });
      } else {
        catalyst = { c: i, close: close[i]!, low: low[i]!, maxHigh: high[i]!, minLow: low[i]!, retested: false };
      }
    }
  }
  return out;
}
