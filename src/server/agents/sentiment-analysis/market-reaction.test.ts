import { describe, expect, it } from "vitest";
import { computeMarketReaction } from "./market-reaction";
import type { PriceBar } from "@/lib/types";

function bar(close: number, volume = 1_000_000): PriceBar {
  return { timestamp: "2026-01-01T00:00:00.000Z", open: close, high: close, low: close, close, volume };
}

describe("computeMarketReaction", () => {
  it("computes recent price change using the shared rateOfChange formula", () => {
    const bars = Array.from({ length: 11 }, (_, i) => bar(100 + i * 2)); // 100..120
    const result = computeMarketReaction(bars);
    expect(result.recentPriceChangePct).toBeCloseTo(((120 - 100) / 100) * 100, 5);
  });

  it("computes volume vs average using the shared volumeTrend formula", () => {
    const bars = [
      ...Array.from({ length: 19 }, () => bar(100, 1_000_000)),
      bar(100, 2_000_000),
    ];
    const result = computeMarketReaction(bars);
    expect(result.volumeVsAverage).not.toBeNull();
    expect(result.volumeVsAverage!).toBeGreaterThan(1);
  });

  it("returns nulls (not a crash) with too little history", () => {
    const result = computeMarketReaction([bar(100)]);
    expect(result.recentPriceChangePct).toBeNull();
  });

  it("is tagged as calculated (deterministic, no AI)", () => {
    const result = computeMarketReaction([bar(100)]);
    expect(result.source).toBe("calculated");
  });
});
