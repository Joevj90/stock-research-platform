import { describe, it, expect } from "vitest";
import {
  evaluateTrendReset,
  simpleMovingAverage,
  rateOfChangePct,
  rollingMaxPrior,
  TREND_RESET_CONFIG,
  TREND_RESET_MIN_BARS,
} from "./trend-reset";
import type { PriceBar } from "./types";

function bar(close: number, dayOffset: number): PriceBar {
  const d = new Date(Date.UTC(2020, 0, 1) + dayOffset * 86_400_000);
  return { timestamp: d.toISOString(), open: close, high: close, low: close, close, volume: 1_000_000 };
}

/** Builds a series from a list of [count, startPrice, endPrice] legs,
 * interpolating linearly within each leg. */
function series(legs: [number, number, number][]): PriceBar[] {
  const bars: PriceBar[] = [];
  let day = 0;
  for (const [count, from, to] of legs) {
    for (let i = 0; i < count; i++) {
      const price = from + ((to - from) * i) / Math.max(1, count - 1);
      bars.push(bar(price, day++));
    }
  }
  return bars;
}

/**
 * The textbook Trend Reset setup: a long steady climb, then a sharp
 * run-up (which puts a high reading into the 63-day rate of change),
 * then a flat stretch long enough that the current 63-day change falls
 * back to roughly zero while the peak is still inside the 60-day
 * lookback.
 */
function qualifyingSeries(): PriceBar[] {
  return series([
    [150, 100, 150], // slow climb -- establishes a rising long-term average
    [30, 150, 190], // sharp run-up -- pushes 63-day change well above 15%
    [81, 190, 190.5], // flat -- 63-day change decays back into the reset band
  ]);
}

describe("indicator helpers", () => {
  it("computes a simple moving average once enough bars exist", () => {
    const values = [1, 2, 3, 4, 5];
    const out = simpleMovingAverage(values, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it("computes rate of change as a percentage", () => {
    const out = rateOfChangePct([100, 110, 120, 130], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(20, 10);
    expect(out[3]).toBeCloseTo((130 / 110 - 1) * 100, 10);
  });

  it("excludes the current bar from the prior-window maximum", () => {
    // "the prior 60 trading days" means before today. If today's own
    // value counted, a stock could satisfy 'was elevated' and 'has
    // reset' from the same bar, which is self-contradictory.
    const values = [1, 5, 2, 99];
    expect(rollingMaxPrior(values, 3, 3)).toBe(5);
  });

  it("returns null when the prior window runs off the start of the data", () => {
    expect(rollingMaxPrior([1, 2, 3], 5, 2)).toBeNull();
  });
});

describe("evaluateTrendReset", () => {
  it("reports insufficient data rather than guessing", () => {
    const result = evaluateTrendReset(series([[50, 100, 120]]));
    expect(result.insufficientData).toBe(true);
    expect(result.qualifies).toBe(false);
    expect(result.conditions).toHaveLength(0);
    expect(result.currentPrice).toBeNull();
  });

  it("needs at least the SMA window plus the rising-SMA lookback", () => {
    expect(TREND_RESET_MIN_BARS).toBe(TREND_RESET_CONFIG.smaPeriod + TREND_RESET_CONFIG.smaRisingLookback);
    const justUnder = series([[TREND_RESET_MIN_BARS - 1, 100, 200]]);
    expect(evaluateTrendReset(justUnder).insufficientData).toBe(true);
  });

  it("identifies a stock meeting all four conditions", () => {
    const result = evaluateTrendReset(qualifyingSeries());

    expect(result.insufficientData).toBe(false);
    expect(result.conditions).toHaveLength(4);
    expect(result.qualifies).toBe(true);
    expect(result.conditions.every((c) => c.passed)).toBe(true);

    // The reset condition is the distinctive one: it fired because the
    // stock went quiet, not because it never moved.
    expect(Math.abs(result.roc63Pct!)).toBeLessThanOrEqual(TREND_RESET_CONFIG.resetBandPct);
    expect(result.maxRoc63PriorPct!).toBeGreaterThanOrEqual(TREND_RESET_CONFIG.elevatedMinRocPct);
  });

  it("fails the 'price above average' condition when the stock has fallen below it", () => {
    // Same setup, then a sharp drop at the end.
    const bars = series([
      [150, 100, 150],
      [30, 150, 190],
      [81, 190, 190.5],
      [10, 190, 120],
    ]);
    const result = evaluateTrendReset(bars);
    const condition = result.conditions[0]!;
    expect(condition.passed).toBe(false);
    expect(condition.detail).toContain("below");
    expect(result.qualifies).toBe(false);
  });

  it("fails the 'has gone quiet' condition while the stock is still running", () => {
    // No flat stretch: the run-up continues to the last bar, so the
    // 63-day change is still far outside the reset band.
    const bars = series([
      [200, 100, 150],
      [61, 150, 200],
    ]);
    const result = evaluateTrendReset(bars);
    const resetCondition = result.conditions[3]!;
    expect(resetCondition.passed).toBe(false);
    expect(result.qualifies).toBe(false);
    expect(Math.abs(result.roc63Pct!)).toBeGreaterThan(TREND_RESET_CONFIG.resetBandPct);
  });

  it("fails the 'was moving' condition for a stock that has only ever crept", () => {
    // Rises steadily but never fast enough to put 15% into any 63-day
    // window -- quiet, but it never earned the reset.
    const bars = series([[261, 100, 104]]);
    const result = evaluateTrendReset(bars);
    const elevated = result.conditions[2]!;
    expect(elevated.passed).toBe(false);
    expect(result.maxRoc63PriorPct!).toBeLessThan(TREND_RESET_CONFIG.elevatedMinRocPct);
    expect(result.qualifies).toBe(false);
  });

  it("fails the 'average is rising' condition in a downtrend", () => {
    const bars = series([
      [150, 200, 150],
      [111, 150, 120],
    ]);
    const result = evaluateTrendReset(bars);
    expect(result.conditions[1]!.passed).toBe(false);
    expect(result.qualifies).toBe(false);
  });

  it("always reports every condition, pass or fail, so a near miss is visible", () => {
    const result = evaluateTrendReset(qualifyingSeries());
    expect(result.conditions.map((c) => c.label)).toEqual([
      expect.stringContaining("200-day average"),
      expect.stringContaining("rising"),
      expect.stringContaining("moving recently"),
      expect.stringContaining("gone quiet"),
    ]);
    for (const c of result.conditions) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it("reports the as-of date from the last bar, so a stale check is detectable", () => {
    const bars = qualifyingSeries();
    const result = evaluateTrendReset(bars);
    expect(result.asOfDate).toBe(bars[bars.length - 1]!.timestamp.slice(0, 10));
  });
});

describe("configuration", () => {
  /**
   * These are the exact values the offline backtest ran with. If one of
   * them changes, the app starts flagging stocks under a rule that has
   * never been tested, while still showing the old backtest's numbers
   * beside them. Changing a threshold means re-running the backtest and
   * updating both -- this test is here to force that conversation.
   */
  it("matches the thresholds the backtest was run with", () => {
    expect(TREND_RESET_CONFIG).toEqual({
      smaPeriod: 200,
      smaRisingLookback: 20,
      rocPeriod: 63,
      elevatedLookback: 60,
      elevatedMinRocPct: 15,
      resetBandPct: 3,
    });
  });
});
