import { describe, expect, it } from "vitest";
import {
  simpleMovingAverage,
  exponentialMovingAverage,
  relativeStrengthIndex,
  macd,
  bollingerBands,
  averageTrueRange,
  volumeTrend,
  annualizedVolatility,
  rateOfChange,
  detectSupportResistance,
} from "./technical-indicators";
import type { PriceBar } from "./types";

function bar(close: number, opts: Partial<PriceBar> = {}): PriceBar {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    open: opts.open ?? close,
    high: opts.high ?? close,
    low: opts.low ?? close,
    close,
    volume: opts.volume ?? 1000,
  };
}

describe("simpleMovingAverage", () => {
  it("returns null before the window is full", () => {
    expect(simpleMovingAverage([1, 2, 3].map((c) => bar(c)), 5)).toEqual([null, null, null]);
  });

  it("computes the average once the window fills", () => {
    const bars = [1, 2, 3, 4, 5].map((c) => bar(c));
    expect(simpleMovingAverage(bars, 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("throws on a non-positive period", () => {
    expect(() => simpleMovingAverage([bar(1)], 0)).toThrow();
  });

  it("handles an empty bars array", () => {
    expect(simpleMovingAverage([], 20)).toEqual([]);
  });
});

describe("exponentialMovingAverage", () => {
  it("seeds with an SMA of the first period, then applies exponential weighting", () => {
    const closes = [10, 11, 12, 13, 14, 15];
    const bars = closes.map((c) => bar(c));
    const ema = exponentialMovingAverage(bars, 3);

    // seed at index 2 = SMA(10,11,12) = 11
    expect(ema[2]).toBeCloseTo(11, 5);
    // next: 13 * (2/4) + 11 * (2/4) = 12
    expect(ema[3]).toBeCloseTo(12, 5);
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBeNull();
  });

  it("returns all nulls when there isn't enough data", () => {
    const bars = [1, 2].map((c) => bar(c));
    expect(exponentialMovingAverage(bars, 5)).toEqual([null, null]);
  });
});

describe("relativeStrengthIndex", () => {
  it("returns 100 for a strictly increasing series (no losses)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bars = closes.map((c) => bar(c));
    const rsi = relativeStrengthIndex(bars, 14);
    expect(rsi[14]).toBe(100);
  });

  it("returns 0 for a strictly decreasing series (no gains)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const bars = closes.map((c) => bar(c));
    const rsi = relativeStrengthIndex(bars, 14);
    expect(rsi[14]).toBe(0);
  });

  it("returns a mid-range value for a mixed series", () => {
    const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    const bars = closes.map((c) => bar(c));
    const rsi = relativeStrengthIndex(bars, 14);
    const last = rsi[14]!;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(100);
  });

  it("stays null before there's enough history", () => {
    const bars = [1, 2, 3].map((c) => bar(c));
    expect(relativeStrengthIndex(bars, 14)).toEqual([null, null, null]);
  });
});

describe("macd", () => {
  it("produces null lines until both EMAs are available, then numeric values", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.5);
    const bars = closes.map((c) => bar(c));
    const result = macd(bars, 12, 26, 9);

    expect(result.line[24]).toBeNull(); // slow EMA(26) not ready yet
    expect(result.line[39]).not.toBeNull();
    expect(result.signal[39]).not.toBeNull();
    expect(result.histogram[39]).toBeCloseTo(result.line[39]! - result.signal[39]!, 8);
  });
});

describe("bollingerBands", () => {
  it("centers the bands on the SMA with upper above and lower below", () => {
    const closes = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19, 18, 20, 19, 21];
    const bars = closes.map((c) => bar(c));
    const { upper, middle, lower } = bollingerBands(bars, 20, 2);

    expect(middle[19]).not.toBeNull();
    expect(upper[19]!).toBeGreaterThan(middle[19]!);
    expect(lower[19]!).toBeLessThan(middle[19]!);
    // symmetric around the middle
    expect(upper[19]! - middle[19]!).toBeCloseTo(middle[19]! - lower[19]!, 8);
  });

  it("returns nulls before the window fills", () => {
    const bars = [1, 2, 3].map((c) => bar(c));
    const { upper, middle, lower } = bollingerBands(bars, 20, 2);
    expect(upper).toEqual([null, null, null]);
    expect(middle).toEqual([null, null, null]);
    expect(lower).toEqual([null, null, null]);
  });
});

describe("averageTrueRange", () => {
  it("is positive when there is any daily range", () => {
    const bars = Array.from({ length: 20 }, (_, i) =>
      bar(100 + i, { high: 100 + i + 1, low: 100 + i - 1 })
    );
    const atr = averageTrueRange(bars, 14);
    expect(atr[14]).not.toBeNull();
    expect(atr[14]!).toBeGreaterThan(0);
  });

  it("is null before there's enough history", () => {
    const bars = [1, 2, 3].map((c) => bar(c));
    expect(averageTrueRange(bars, 14)).toEqual([null, null, null]);
  });
});

describe("volumeTrend", () => {
  it("computes latest volume vs trailing average", () => {
    const bars = [
      ...Array.from({ length: 19 }, () => bar(100, { volume: 1000 })),
      bar(100, { volume: 3000 }),
    ];
    const trend = volumeTrend(bars, 20);
    expect(trend.latestVolume).toBe(3000);
    expect(trend.averageVolume).toBeCloseTo((1000 * 19 + 3000) / 20, 5);
    expect(trend.ratio!).toBeGreaterThan(1);
  });

  it("returns null average when there isn't enough history", () => {
    const bars = [bar(100, { volume: 500 })];
    const trend = volumeTrend(bars, 20);
    expect(trend.averageVolume).toBeNull();
    expect(trend.ratio).toBeNull();
    expect(trend.latestVolume).toBe(500);
  });
});

describe("annualizedVolatility", () => {
  it("is zero for a perfectly flat price series", () => {
    const bars = Array.from({ length: 25 }, () => bar(100));
    expect(annualizedVolatility(bars, 20)).toBeCloseTo(0, 5);
  });

  it("is positive when prices actually move", () => {
    const closes = [100, 105, 98, 107, 95, 110, 100, 103, 99, 108, 97, 106, 101, 104, 98, 109, 100, 105, 99, 107, 102];
    const bars = closes.map((c) => bar(c));
    const vol = annualizedVolatility(bars, 20);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0);
  });

  it("returns null with too little history", () => {
    expect(annualizedVolatility([bar(1), bar(2)], 20)).toBeNull();
  });
});

describe("rateOfChange", () => {
  it("computes percentage change over the window", () => {
    const bars = Array.from({ length: 11 }, (_, i) => bar(100 + i * 10)); // 100..200
    const roc = rateOfChange(bars, 10);
    expect(roc).toBeCloseTo(((200 - 100) / 100) * 100, 5);
  });

  it("returns null without enough history", () => {
    expect(rateOfChange([bar(1), bar(2)], 10)).toBeNull();
  });
});

describe("detectSupportResistance", () => {
  it("finds a swing low as support and swing high as resistance", () => {
    // Dips to 90 then rises to a clear peak at 104, with enough bars on
    // both sides of each pivot for the detection window to confirm them.
    const closes = [
      100, 98, 96, 94, 92, 90, 92, 94, 96, 98, 100, 102, 104, 102, 100, 98, 96, 98, 100,
    ];
    const bars = closes.map((c) => bar(c, { high: c, low: c }));
    const { support, resistance } = detectSupportResistance(bars, 3, 3);

    // current price is last close = 100; support should include something
    // below 100 (the 90 dip), resistance something above (the 104 peak).
    expect(support.some((s) => s < 100)).toBe(true);
    expect(resistance.some((r) => r > 100)).toBe(true);
  });

  it("returns empty arrays for an empty series", () => {
    expect(detectSupportResistance([])).toEqual({ support: [], resistance: [] });
  });
});
