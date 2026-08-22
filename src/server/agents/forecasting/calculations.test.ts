import { describe, expect, it } from "vitest";
import {
  normalizeProbabilities,
  computeExpectedPrice,
  computeExpectedReturnPct,
  roundPriceForDisplay,
  roundReturnPct,
} from "./calculations";

describe("normalizeProbabilities", () => {
  it("leaves already-valid probabilities (summing to 100) unchanged", () => {
    const result = normalizeProbabilities(20, 50, 30);
    expect(result).toEqual({ bear: 20, base: 50, bull: 30 });
    expect(result.bear + result.base + result.bull).toBe(100);
  });

  it("rescales probabilities that do not sum to 100", () => {
    // AI gave 10/50/20 (sums to 80) -- should rescale proportionally to sum to 100
    const result = normalizeProbabilities(10, 50, 20);
    expect(result.bear + result.base + result.bull).toBe(100);
    // proportions should be roughly preserved: base should still be the largest
    expect(result.base).toBeGreaterThan(result.bear);
    expect(result.base).toBeGreaterThan(result.bull);
  });

  it("always sums to EXACTLY 100 even with awkward rounding cases", () => {
    // 33.33/33.33/33.33 repeating -- classic rounding trap
    const result = normalizeProbabilities(1, 1, 1);
    expect(result.bear + result.base + result.bull).toBe(100);
  });

  it("sums to exactly 100 across a wide range of random-ish inputs", () => {
    const cases: [number, number, number][] = [
      [17, 41, 42],
      [5, 5, 90],
      [33, 33, 34],
      [1, 98, 1],
      [7, 7, 7],
      [60, 25, 15],
    ];
    for (const [b, base, bull] of cases) {
      const result = normalizeProbabilities(b, base, bull);
      expect(result.bear + result.base + result.bull).toBe(100);
      expect(result.bear).toBeGreaterThanOrEqual(0);
      expect(result.base).toBeGreaterThanOrEqual(0);
      expect(result.bull).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to an even split for degenerate zero-sum input rather than dividing by zero", () => {
    const result = normalizeProbabilities(0, 0, 0);
    expect(result.bear + result.base + result.bull).toBe(100);
  });
});

describe("computeExpectedPrice", () => {
  it("computes the probability-weighted average exactly per the spec's formula", () => {
    const price = computeExpectedPrice({
      bear: { priceTarget: 100, probabilityPct: 20 },
      base: { priceTarget: 150, probabilityPct: 50 },
      bull: { priceTarget: 200, probabilityPct: 30 },
    });
    // (0.2*100) + (0.5*150) + (0.3*200) = 20 + 75 + 60 = 155
    expect(price).toBeCloseTo(155, 5);
  });

  it("returns exactly the single price when one scenario has 100% probability", () => {
    const price = computeExpectedPrice({
      bear: { priceTarget: 50, probabilityPct: 0 },
      base: { priceTarget: 150, probabilityPct: 100 },
      bull: { priceTarget: 300, probabilityPct: 0 },
    });
    expect(price).toBeCloseTo(150, 5);
  });

  it("is symmetric: equal weights average the three prices evenly", () => {
    const price = computeExpectedPrice({
      bear: { priceTarget: 90, probabilityPct: 33 },
      base: { priceTarget: 120, probabilityPct: 34 },
      bull: { priceTarget: 150, probabilityPct: 33 },
    });
    // Close to the simple average of 90, 120, 150 = 120
    expect(price).toBeCloseTo(120, 0);
  });
});

describe("computeExpectedReturnPct", () => {
  it("computes percentage return exactly per the spec's formula", () => {
    const returnPct = computeExpectedReturnPct(120, 100);
    expect(returnPct).toBeCloseTo(20, 5);
  });

  it("computes a negative return when expected price is below current price", () => {
    const returnPct = computeExpectedReturnPct(80, 100);
    expect(returnPct).toBeCloseTo(-20, 5);
  });

  it("returns zero return when expected price equals current price", () => {
    expect(computeExpectedReturnPct(100, 100)).toBeCloseTo(0, 5);
  });

  it("returns 0 (not NaN/Infinity) for a non-positive current price, guarding against division by zero", () => {
    expect(computeExpectedReturnPct(100, 0)).toBe(0);
    expect(computeExpectedReturnPct(100, -5)).toBe(0);
  });
});

describe("roundPriceForDisplay", () => {
  it("rounds sub-$20 prices to the nearest 50 cents", () => {
    expect(roundPriceForDisplay(14.73)).toBeCloseTo(14.5, 5);
    expect(roundPriceForDisplay(14.9)).toBeCloseTo(15, 5);
  });

  it("rounds $20-$200 prices to the nearest whole dollar, avoiding false precision like $183.47", () => {
    expect(roundPriceForDisplay(183.47)).toBe(183);
    expect(roundPriceForDisplay(199.6)).toBe(200);
  });

  it("rounds $200-$1000 prices to the nearest $5", () => {
    expect(roundPriceForDisplay(523)).toBe(525);
    expect(roundPriceForDisplay(401)).toBe(400);
  });

  it("rounds prices above $1000 to the nearest $10", () => {
    expect(roundPriceForDisplay(1234)).toBe(1230);
  });

  it("returns 0 for non-positive input rather than a negative or NaN price", () => {
    expect(roundPriceForDisplay(0)).toBe(0);
    expect(roundPriceForDisplay(-10)).toBe(0);
  });
});

describe("roundReturnPct", () => {
  it("rounds to the nearest tenth of a percent", () => {
    expect(roundReturnPct(12.345)).toBeCloseTo(12.3, 5);
    expect(roundReturnPct(12.36)).toBeCloseTo(12.4, 5);
  });
});
