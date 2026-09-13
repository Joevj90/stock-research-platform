import { describe, expect, it } from "vitest";
import type { PriceBar } from "@/lib/types";
import { backtestPatterns } from "./pattern-backtest";

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
