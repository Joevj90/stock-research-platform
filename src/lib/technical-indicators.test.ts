import { describe, expect, it } from "vitest";
import { simpleMovingAverage } from "./technical-indicators";
import type { PriceBar } from "./types";

function bar(close: number): PriceBar {
  return { timestamp: "2026-01-01T00:00:00.000Z", open: close, high: close, low: close, close, volume: 100 };
}

describe("simpleMovingAverage", () => {
  it("returns null before the window is full", () => {
    const bars = [1, 2, 3].map(bar);
    const sma = simpleMovingAverage(bars, 5);
    expect(sma).toEqual([null, null, null]);
  });

  it("computes the average once the window fills", () => {
    const bars = [1, 2, 3, 4, 5].map(bar);
    const sma = simpleMovingAverage(bars, 3);
    // first two undefined, then (1+2+3)/3, (2+3+4)/3, (3+4+5)/3
    expect(sma).toEqual([null, null, 2, 3, 4]);
  });

  it("matches a manually computed 20-period average on a longer series", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i); // 100..124
    const bars = closes.map(bar);
    const sma = simpleMovingAverage(bars, 20);

    // last value: average of closes[5..24] = 105..124
    const expectedLast = (105 + 124) * 20 / 2 / 20; // sum of arithmetic series / n
    expect(sma[24]).toBeCloseTo(expectedLast, 5);
    expect(sma[18]).toBeNull();
    expect(sma[19]).not.toBeNull();
  });

  it("throws on a non-positive period", () => {
    expect(() => simpleMovingAverage([bar(1)], 0)).toThrow();
    expect(() => simpleMovingAverage([bar(1)], -5)).toThrow();
  });

  it("handles an empty bars array", () => {
    expect(simpleMovingAverage([], 20)).toEqual([]);
  });
});
