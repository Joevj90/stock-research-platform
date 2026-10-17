import { describe, it, expect } from "vitest";
import { evaluateTrendReset, TREND_RESET_CONFIG } from "./trend-reset";
import type { PriceBar } from "./types";

/**
 * CROSS-CHECK: the app must flag exactly the stocks the backtest
 * counted as signals.
 *
 * The app and the offline backtest are two separate implementations of
 * the same four rules, written in different files in different
 * languages, and only one of them was validated against nineteen years
 * of data. If they disagree, the watchlist shows signals for a rule
 * nobody tested while displaying the tested rule's statistics beside
 * them -- which is worse than having no watchlist, because it looks
 * authoritative.
 *
 * `backtestFindSignals` below is the backtest's algorithm, transcribed
 * from trend-reset-backtest.mjs. It is deliberately a separate
 * implementation rather than a shared import: if the app's version is
 * edited, this test fails instead of quietly agreeing with itself.
 */

function backtestSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function backtestRoc(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const past = values[i - period]!;
    if (past > 0) out[i] = (values[i]! / past - 1) * 100;
  }
  return out;
}

function backtestRollingMaxPrior(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const start = i - window;
    if (start < 0) continue;
    let max: number | null = null;
    for (let j = start; j < i; j++) {
      const v = values[j];
      if (v === null || v === undefined) continue;
      if (max === null || v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

/** Transcribed from the backtest's findSignals. Returns the set of bar
 * indices where all four conditions hold. */
function backtestFindSignals(bars: PriceBar[]): Set<number> {
  const C = TREND_RESET_CONFIG;
  const closes = bars.map((b) => b.close);
  const sma200 = backtestSma(closes, C.smaPeriod);
  const roc63 = backtestRoc(closes, C.rocPeriod);
  const maxRocPrior = backtestRollingMaxPrior(roc63, C.elevatedLookback);

  const signals = new Set<number>();
  for (let i = 0; i < bars.length - 1; i++) {
    const s = sma200[i];
    const sPast = sma200[i - C.smaRisingLookback];
    const r = roc63[i];
    const maxR = maxRocPrior[i];
    if (s === null || s === undefined) continue;
    if (sPast === null || sPast === undefined) continue;
    if (r === null || r === undefined || maxR === null || maxR === undefined) continue;

    if (
      closes[i]! > s &&
      s > sPast &&
      maxR >= C.elevatedMinRocPct &&
      r >= -C.resetBandPct &&
      r <= C.resetBandPct
    ) {
      signals.add(i);
    }
  }
  return signals;
}

/** A pseudo-random but deterministic price path with alternating calm
 * and trending regimes, so signals genuinely fire somewhere in it. */
function syntheticPath(seed: number, length: number): PriceBar[] {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const bars: PriceBar[] = [];
  let price = 100;
  let regime = 0;
  let left = 0;

  for (let i = 0; i < length; i++) {
    if (left <= 0) {
      regime = [1, 1, -1, 0][Math.floor(rand() * 4)]!;
      left = 30 + Math.floor(rand() * 120);
    }
    left--;
    const drift = { 1: 0.0022, "-1": -0.0018, 0: 0.0001 }[String(regime) as "1" | "-1" | "0"]!;
    price = Math.max(1, price * (1 + drift + (rand() - 0.5) * 0.02));
    const d = new Date(Date.UTC(2010, 0, 1) + i * 86_400_000);
    bars.push({
      timestamp: d.toISOString(),
      open: price,
      high: price * 1.004,
      low: price * 0.996,
      close: price,
      volume: 1_000_000,
    });
  }
  return bars;
}

describe("the app's rule agrees with the backtest's rule", () => {
  it("flags exactly the same bars across several synthetic price histories", () => {
    let totalChecked = 0;
    let totalSignals = 0;

    for (const seed of [1, 7, 42, 2026, 99991]) {
      const bars = syntheticPath(seed, 900);
      const backtestSignals = backtestFindSignals(bars);

      // The app evaluates the LAST bar of whatever history it is given,
      // so replay the series one day at a time and compare each day's
      // verdict with the backtest's verdict for that same bar.
      for (let i = 300; i < bars.length - 1; i++) {
        const asOfToday = bars.slice(0, i + 1);
        const appSaysQualifies = evaluateTrendReset(asOfToday).qualifies;
        const backtestSaysSignal = backtestSignals.has(i);

        expect(
          appSaysQualifies,
          `seed ${seed}, bar ${i}: app said ${appSaysQualifies}, backtest said ${backtestSaysSignal}`
        ).toBe(backtestSaysSignal);

        totalChecked++;
        if (backtestSaysSignal) totalSignals++;
      }
    }

    // Guard against a vacuous pass: if the synthetic paths never
    // produced a single signal, the comparison above proved nothing.
    expect(totalChecked).toBeGreaterThan(2000);
    expect(totalSignals).toBeGreaterThan(20);
  });
});
