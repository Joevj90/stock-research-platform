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
  /** Relative-strength leadership tag (see rsLeadershipTags): true = the
   * stock made a new relative high vs SPY while SPY was weak, within the
   * last few weeks; false = SPY was weak but the stock did not lead;
   * null = SPY was not weak, nothing to measure. */
  selloffStrength: boolean | null;
}

/** The index (SPY), keyed by date, for the relative-strength tag. */
export interface IndexContext {
  dates: string[];
  close: number[];
  indexByDate: Map<string, number>;
}

export function buildIndexContext(s: DailySeries): IndexContext {
  return { dates: s.dates, close: s.close, indexByDate: new Map(s.dates.map((d, i) => [d, i])) };
}

export function isGovernanceExcluded(symbol: string, date: string, cfg: BreakoutConfig): boolean {
  return cfg.governanceExclusions.some((g) => g.symbol === symbol && date >= g.from);
}

export function liquidityTier(avgDollar50: number, cfg: BreakoutConfig): LiquidityTier {
  if (avgDollar50 >= cfg.largeTierDollarVolume) return "large";
  if (avgDollar50 >= cfg.midTierDollarVolume) return "mid";
  return "small";
}

/**
 * Which days a stock was tradable under the eligibility rules, and its
 * liquidity tier on each day, using only data up to that day. Shared by
 * the signals and by the random-entry control, so both draw from the
 * same pool of stocks.
 */
export function eligibilityByDay(
  s: DailySeries,
  cfg: BreakoutConfig,
): { eligible: boolean[]; tier: (LiquidityTier | null)[] } {
  const dollar = s.close.map((c, i) => c * s.volume[i]!);
  const avgDollar20 = priorAverage(dollar, 20);
  const avgDollar50 = priorAverage(dollar, 50);
  const eligible: boolean[] = [];
  const tier: (LiquidityTier | null)[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const has = Number.isFinite(avgDollar50[i]!);
    eligible.push(
      has &&
        s.close[i]! >= cfg.minPrice &&
        avgDollar20[i]! >= cfg.minAvgDollarVolume &&
        !isGovernanceExcluded(s.symbol, s.dates[i]!, cfg),
    );
    tier.push(has ? liquidityTier(avgDollar50[i]!, cfg) : null);
  }
  return { eligible, tier };
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
 * Relative-strength leadership tag for every day of a stock (see the
 * rs* settings in config.ts). Uses only data up to each day.
 */
export function rsLeadershipTags(s: DailySeries, index: IndexContext | null, cfg: BreakoutConfig): (boolean | null)[] {
  const n = s.dates.length;
  const out: (boolean | null)[] = new Array<boolean | null>(n).fill(null);
  if (!index) return out;
  const L = cfg.rsHighLookbackDays;
  const ratio = new Array<number>(n).fill(NaN);
  const indexWeak = new Array<boolean>(n).fill(false);
  const event = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const j = index.indexByDate.get(s.dates[i]!);
    if (j === undefined) continue;
    ratio[i] = s.close[i]! / index.close[j]!;
    if (j >= L - 1) indexWeak[i] = index.close[j]! <= maxOf(index.close, j - L + 1, j) * (1 - cfg.rsIndexMinDrawdown);
    if (indexWeak[i] && i >= L) {
      let prior = -Infinity;
      for (let k = i - L; k < i; k++) if (Number.isFinite(ratio[k]!) && ratio[k]! > prior) prior = ratio[k]!;
      event[i] = Number.isFinite(prior) && ratio[i]! > prior;
    }
  }
  const R = cfg.rsRecentDays;
  for (let i = 0; i < n; i++) {
    let weakSeen = false;
    let led = false;
    for (let k = Math.max(0, i - R + 1); k <= i; k++) {
      if (indexWeak[k]) weakSeen = true;
      if (event[k]) led = true;
    }
    out[i] = weakSeen ? led : null;
  }
  return out;
}

/** Returns, for each bar, the signals that fired at that bar's close. */
export function computeSignals(s: DailySeries, cfg: BreakoutConfig, index: IndexContext | null): Signal[][] {
  const n = s.dates.length;
  const out: Signal[][] = Array.from({ length: n }, () => []);
  const { open, high, low, close, volume } = s;

  const avgVol20 = priorAverage(volume, 20);
  const vol10 = sma(volume, 10);
  const sma50 = sma(close, 50);
  const elig = eligibilityByDay(s, cfg);
  const rsTags = rsLeadershipTags(s, index, cfg);

  const T = cfg.tightDays;
  const firstA = T + cfg.dryUpLookbackDays + 10;

  let breakout: { b: number; pivot: number; avgVolAtB: number } | null = null;
  let catalyst: { c: number; close: number; low: number; maxHigh: number; minLow: number; retested: boolean } | null =
    null;

  for (let i = 1; i < n; i++) {
    const tier = elig.tier[i];
    if (!Number.isFinite(avgVol20[i]!) || tier == null) continue;
    const eligible = elig.eligible[i]!;
    const volRatio = avgVol20[i]! > 0 ? volume[i]! / avgVol20[i]! : 0;
    const emit = (sig: Omit<Signal, "index" | "date" | "tier" | "volumeRatio" | "selloffStrength">) => {
      if (!eligible) return;
      const strength = rsTags[i]!;
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
