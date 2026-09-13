import { describe, expect, it } from "vitest";
import type { PriceBar } from "@/lib/types";
import {
  detectEngulfing,
  detectGaps,
  detectHammerAndStar,
  detectRsiDivergence,
  detectAllPatterns,
  trendlineSlopePctPerBar,
} from "./chart-patterns";

function bar(open: number, high: number, low: number, close: number, volume = 1000, day = 1): PriceBar {
  return {
    timestamp: new Date(Date.UTC(2026, 0, day, 14, 30)).toISOString(),
    open,
    high,
    low,
    close,
    volume,
  };
}

/** Flat filler bars, used to pad a series without accidentally creating
 * a pattern the test didn't intend. */
function flat(count: number, price = 100): PriceBar[] {
  return Array.from({ length: count }, (_, i) => bar(price, price + 0.1, price - 0.1, price, 1000, i + 1));
}

describe("detectEngulfing", () => {
  it("detects a bullish engulfing candle", () => {
    const bars = [bar(100, 100.5, 98, 98.5), bar(98, 102, 97.5, 101.5)];
    const found = detectEngulfing(bars);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("bullish_engulfing");
    expect(found[0]!.direction).toBe("bullish");
    expect(found[0]!.barIndex).toBe(1);
  });

  it("detects a bearish engulfing candle", () => {
    const bars = [bar(100, 102, 99.5, 101.5), bar(102, 102.5, 99, 99.5)];
    const found = detectEngulfing(bars);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("bearish_engulfing");
    expect(found[0]!.direction).toBe("bearish");
  });

  it("does not fire when the second candle runs the same direction as the first", () => {
    // Bigger body, but both bullish -- continuation, not a reversal.
    const bars = [bar(99, 100.5, 98.9, 100), bar(98, 102, 97.9, 101.5)];
    expect(detectEngulfing(bars)).toHaveLength(0);
  });

  it("does not fire when the body is not fully engulfed", () => {
    const bars = [bar(100, 100.5, 98, 98.5), bar(99, 100, 98.5, 99.5)];
    expect(detectEngulfing(bars)).toHaveLength(0);
  });
});

describe("detectHammerAndStar", () => {
  it("detects a hammer only after a decline", () => {
    // Six declining bars, then a long-lower-shadow candle.
    const declining = [
      bar(110, 110.2, 109, 109, 1000, 1),
      bar(109, 109.2, 108, 108, 1000, 2),
      bar(108, 108.2, 107, 107, 1000, 3),
      bar(107, 107.2, 106, 106, 1000, 4),
      bar(106, 106.2, 105, 105, 1000, 5),
      bar(105, 105.2, 104, 104, 1000, 6),
    ];
    const hammer = bar(104, 104.3, 101, 104.2, 1000, 7);
    const found = detectHammerAndStar([...declining, hammer]);
    expect(found.map((f) => f.key)).toContain("hammer");
  });

  it("does not call the same candle shape a hammer after a rise", () => {
    const rising = [
      bar(100, 101, 99.8, 101, 1000, 1),
      bar(101, 102, 100.8, 102, 1000, 2),
      bar(102, 103, 101.8, 103, 1000, 3),
      bar(103, 104, 102.8, 104, 1000, 4),
      bar(104, 105, 103.8, 105, 1000, 5),
      bar(105, 106, 104.8, 106, 1000, 6),
    ];
    // Identical anatomy to the hammer above, but the trend into it is up.
    const sameShape = bar(106, 106.3, 103, 106.2, 1000, 7);
    const found = detectHammerAndStar([...rising, sameShape]);
    expect(found.map((f) => f.key)).not.toContain("hammer");
  });

  it("detects a shooting star after a rise", () => {
    const rising = [
      bar(100, 101, 99.8, 101, 1000, 1),
      bar(101, 102, 100.8, 102, 1000, 2),
      bar(102, 103, 101.8, 103, 1000, 3),
      bar(103, 104, 102.8, 104, 1000, 4),
      bar(104, 105, 103.8, 105, 1000, 5),
      bar(105, 106, 104.8, 106, 1000, 6),
    ];
    const star = bar(106, 109, 105.8, 106.2, 1000, 7);
    const found = detectHammerAndStar([...rising, star]);
    expect(found.map((f) => f.key)).toContain("shooting_star");
  });
});

describe("detectGaps", () => {
  it("detects a gap up above the previous bar's high", () => {
    const bars = [bar(100, 101, 99, 100.5), bar(103, 104, 102.5, 103.5)];
    const found = detectGaps(bars);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("gap_up");
  });

  it("detects a gap down below the previous bar's low", () => {
    const bars = [bar(100, 101, 99, 100.5), bar(97, 98, 96.5, 97.5)];
    const found = detectGaps(bars);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("gap_down");
  });

  it("ignores gaps smaller than the minimum percentage", () => {
    // Opens above prior high, but only by a hair.
    const bars = [bar(100, 100.1, 99.9, 100), bar(100.15, 100.2, 100.1, 100.18)];
    expect(detectGaps(bars, 0.5)).toHaveLength(0);
  });

  it("does not report a gap when bars overlap", () => {
    const bars = [bar(100, 101, 99, 100.5), bar(100.2, 101.5, 99.8, 101)];
    expect(detectGaps(bars)).toHaveLength(0);
  });
});

describe("detectRsiDivergence", () => {
  it("flags a bearish divergence when price makes a higher high but momentum fades", () => {
    // Sharp early rally (drives RSI high), pullback, then a slow grind to
    // a marginally higher high -- the classic weakening-momentum shape.
    const bars: PriceBar[] = [];
    let price = 100;
    for (let i = 0; i < 14; i++) {
      price += 2;
      bars.push(bar(price - 1, price + 0.5, price - 1.5, price, 1000, i + 1));
    }
    for (let i = 0; i < 10; i++) {
      price -= 1.2;
      bars.push(bar(price + 1, price + 1.2, price - 0.5, price, 1000, i + 15));
    }
    for (let i = 0; i < 14; i++) {
      price += 1.05;
      bars.push(bar(price - 0.5, price + 0.3, price - 0.7, price, 1000, i + 25));
    }

    const found = detectRsiDivergence(bars);
    expect(found.some((f) => f.key === "bearish_rsi_divergence")).toBe(true);
  });

  it("returns nothing on a series too short to compute RSI", () => {
    expect(detectRsiDivergence(flat(5))).toEqual([]);
  });
});

describe("trendlineSlopePctPerBar", () => {
  it("returns a positive slope for a rising series", () => {
    const bars = [bar(100, 100, 100, 100), bar(101, 101, 101, 101), bar(102, 102, 102, 102)];
    expect(trendlineSlopePctPerBar(bars)!).toBeGreaterThan(0);
  });

  it("returns a negative slope for a falling series", () => {
    const bars = [bar(102, 102, 102, 102), bar(101, 101, 101, 101), bar(100, 100, 100, 100)];
    expect(trendlineSlopePctPerBar(bars)!).toBeLessThan(0);
  });

  it("returns approximately zero for a flat series", () => {
    expect(Math.abs(trendlineSlopePctPerBar(flat(10))!)).toBeLessThan(1e-9);
  });

  it("returns null when there aren't enough bars", () => {
    expect(trendlineSlopePctPerBar([bar(100, 100, 100, 100)])).toBeNull();
  });
});

describe("detectAllPatterns", () => {
  it("returns results sorted chronologically by bar index", () => {
    const bars = [
      bar(100, 100.5, 98, 98.5, 1000, 1),
      bar(98, 102, 97.5, 101.5, 1000, 2), // bullish engulfing at index 1
      bar(105, 106, 104.5, 105.5, 1000, 3), // gap up at index 2
    ];
    const found = detectAllPatterns(bars);
    expect(found.length).toBeGreaterThanOrEqual(2);
    const indexes = found.map((f) => f.barIndex);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it("returns an empty array for a featureless series", () => {
    expect(detectAllPatterns(flat(30))).toEqual([]);
  });
});
