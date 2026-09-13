import { describe, expect, it } from "vitest";
import type { PriceBar } from "@/lib/types";
import { backtestPatterns, poolContributions } from "./pattern-backtest";

function bar(open: number, high: number, low: number, close: number, day: number): PriceBar {
  return {
    timestamp: new Date(Date.UTC(2026, 0, day, 14, 30)).toISOString(),
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

/** A series that rises steadily, so the "always guess up" baseline is
 * near-perfect and any bullish pattern should show roughly zero edge. */
function steadilyRising(count: number): PriceBar[] {
  const bars: PriceBar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price *= 1.01;
    bars.push(bar(price * 0.999, price * 1.002, price * 0.997, price, i + 1));
  }
  return bars;
}

describe("backtestPatterns", () => {
  it("reports the sample's up-rate, which is what bare hit rates would hide", () => {
    const result = backtestPatterns("TEST", steadilyRising(100), 5);
    // Every forward window rises in this series.
    expect(result.upRateAllBars).toBeCloseTo(1, 5);
  });

  it("gives a bullish pattern roughly zero edge when everything rises anyway", () => {
    // Insert a bullish engulfing into an always-rising series. It will be
    // "right" every time, but so would guessing up blindly -- so the
    // edge, not the hit rate, is what must stay near zero.
    const bars = steadilyRising(60);
    bars.splice(
      20,
      2,
      bar(110, 110.5, 108, 108.5, 21), // down bar
      bar(108, 113, 107.5, 112.5, 22) // engulfing up bar
    );

    const result = backtestPatterns("TEST", bars, 5);
    const bullish = result.patterns.find((p) => p.key === "bullish_engulfing");
    if (bullish) {
      expect(bullish.hitRate).toBeGreaterThan(0.5);
      expect(Math.abs(bullish.edge)).toBeLessThan(0.2);
    }
  });

  it("never marks a small sample as statistically meaningful, however large the edge", () => {
    const bars = steadilyRising(60);
    bars.splice(20, 2, bar(110, 110.5, 108, 108.5, 21), bar(108, 113, 107.5, 112.5, 22));

    const result = backtestPatterns("TEST", bars, 5);
    for (const p of result.patterns) {
      if (p.sampleSize < 30) {
        expect(p.isStatisticallyMeaningful).toBe(false);
      }
    }
  });

  it("computes a trend-continuation baseline as the harder comparison", () => {
    const result = backtestPatterns("TEST", steadilyRising(100), 5);
    // In a monotonic series, trend continuation is always right.
    expect(result.trendContinuationHitRate).toBeCloseTo(1, 5);
    expect(result.trendContinuationSampleSize).toBeGreaterThan(0);
  });

  it("does not look ahead: bars after the horizon are unevaluable and excluded", () => {
    const bars = steadilyRising(40);
    const result = backtestPatterns("TEST", bars, 10);
    for (const p of result.patterns) {
      // Every counted occurrence must have had 10 further bars available.
      expect(p.sampleSize).toBeLessThanOrEqual(bars.length - 10);
    }
  });

  it("orders statistically meaningful results ahead of unproven ones", () => {
    const result = backtestPatterns("TEST", steadilyRising(200), 5);
    const flags = result.patterns.map((p) => p.isStatisticallyMeaningful);
    const firstUnproven = flags.indexOf(false);
    if (firstUnproven !== -1) {
      expect(flags.slice(firstUnproven).every((f) => f === false)).toBe(true);
    }
  });

  it("handles a series with no detectable patterns without throwing", () => {
    const flatBars = Array.from({ length: 50 }, (_, i) => bar(100, 100.1, 99.9, 100, i + 1));
    const result = backtestPatterns("TEST", flatBars, 5);
    expect(result.patterns).toEqual([]);
    expect(result.totalBars).toBe(50);
  });

  it("reports average favourable return signed in the pattern's direction", () => {
    const bars = steadilyRising(80);
    bars.splice(20, 2, bar(110, 110.5, 108, 108.5, 21), bar(108, 113, 107.5, 112.5, 22));
    const result = backtestPatterns("TEST", bars, 5);
    const bullish = result.patterns.find((p) => p.key === "bullish_engulfing");
    if (bullish) {
      // Rising series, bullish pattern -- favourable return is positive.
      expect(bullish.averageFavourableReturnPct).toBeGreaterThan(0);
    }
  });
});

describe("poolContributions", () => {
  function contribution(
    ticker: string,
    upRate: number,
    patterns: Array<{ key: string; hits: number; total: number; direction?: "bullish" | "bearish" }>
  ) {
    const byPattern = new Map<
      string,
      { name: string; direction: "bullish" | "bearish"; hits: number; total: number; favourableSum: number }
    >();
    for (const p of patterns) {
      byPattern.set(p.key, {
        name: p.key,
        direction: p.direction ?? "bullish",
        hits: p.hits,
        total: p.total,
        favourableSum: 0,
      });
    }
    return { ticker, byPattern, upRate, evaluableBars: 1000 };
  }

  it("sums occurrences across tickers instead of averaging their rates", () => {
    const pooled = poolContributions(
      [
        contribution("AAA", 0.5, [{ key: "bullish_engulfing", hits: 10, total: 20 }]),
        contribution("BBB", 0.5, [{ key: "bullish_engulfing", hits: 30, total: 40 }]),
      ],
      78
    );

    const p = pooled.patterns.find((x) => x.key === "bullish_engulfing")!;
    expect(p.sampleSize).toBe(60);
    // 40 hits of 60, not the mean of 50% and 75%.
    expect(p.hitRate).toBeCloseTo(40 / 60, 6);
  });

  it("weights each pattern's baseline by where its occurrences came from", () => {
    // Nearly all occurrences come from the strongly-rising ticker, so the
    // blended baseline must sit close to that ticker's 0.8, not the
    // midpoint of 0.8 and 0.4.
    const pooled = poolContributions(
      [
        contribution("RISER", 0.8, [{ key: "hammer", hits: 90, total: 100 }]),
        contribution("FLAT", 0.4, [{ key: "hammer", hits: 1, total: 2 }]),
      ],
      78
    );

    const p = pooled.patterns.find((x) => x.key === "hammer")!;
    expect(p.baselineHitRate).toBeGreaterThan(0.75);
    expect(p.baselineHitRate).toBeLessThan(0.8);
  });

  it("uses the complement of the up-rate as the baseline for bearish patterns", () => {
    const pooled = poolContributions(
      [contribution("AAA", 0.7, [{ key: "shooting_star", hits: 20, total: 50, direction: "bearish" }])],
      78
    );

    const p = pooled.patterns.find((x) => x.key === "shooting_star")!;
    expect(p.baselineHitRate).toBeCloseTo(0.3, 6);
  });

  it("reaches a meaningful verdict on a pooled sample that no single ticker could support", () => {
    // Each ticker alone has 20 occurrences (below the 30 gate); pooled
    // they clear it, with a large enough edge to beat noise.
    const pooled = poolContributions(
      [
        contribution("AAA", 0.5, [{ key: "gap_up", hits: 18, total: 20 }]),
        contribution("BBB", 0.5, [{ key: "gap_up", hits: 17, total: 20 }]),
        contribution("CCC", 0.5, [{ key: "gap_up", hits: 18, total: 20 }]),
      ],
      78
    );

    const p = pooled.patterns.find((x) => x.key === "gap_up")!;
    expect(p.sampleSize).toBe(60);
    expect(p.isStatisticallyMeaningful).toBe(true);
  });

  it("still refuses a verdict when the pooled sample is under the gate", () => {
    const pooled = poolContributions(
      [contribution("AAA", 0.5, [{ key: "gap_down", hits: 10, total: 10, direction: "bearish" }])],
      78
    );

    const p = pooled.patterns.find((x) => x.key === "gap_down")!;
    expect(p.isStatisticallyMeaningful).toBe(false);
  });

  it("handles a pattern that only appears in one of several tickers", () => {
    const pooled = poolContributions(
      [
        contribution("AAA", 0.5, [{ key: "hammer", hits: 5, total: 10 }]),
        contribution("BBB", 0.5, [{ key: "gap_up", hits: 3, total: 4 }]),
      ],
      78
    );

    expect(pooled.patterns.map((p) => p.key).sort()).toEqual(["gap_up", "hammer"]);
  });
});
