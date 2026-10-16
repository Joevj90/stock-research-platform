import { describe, it, expect } from "vitest";
import {
  dailyVolatilityPct,
  horizonVolatilityPct,
  typicalMovePct,
  typicalMoveByHorizonPct,
  widenRangeToVolatility,
  MIN_RANGE_SIGMAS,
  TRADING_DAYS_BY_HORIZON,
} from "./volatility";

/** A stock with 32% annualized volatility -- roughly 2% a day, which is
 * ordinary for a mid-cap name and close to the real figures that
 * produced the overconfident 1-week ranges in the v1 prediction data. */
const ORDINARY = { volatilityAnnualizedPct: 31.75, atrPct: 3.2 };

describe("dailyVolatilityPct", () => {
  it("converts annualized volatility to a daily figure", () => {
    // 31.75 / sqrt(252) ~= 2.0
    expect(dailyVolatilityPct(ORDINARY)).toBeCloseTo(2.0, 1);
  });

  it("prefers realized volatility over the ATR approximation", () => {
    const withBoth = dailyVolatilityPct({ volatilityAnnualizedPct: 31.75, atrPct: 99 });
    expect(withBoth).toBeCloseTo(2.0, 1);
  });

  it("falls back to ATR when realized volatility is missing", () => {
    // ATR is a high-low range, so it is divided down to a sigma rather
    // than used as one.
    const fromAtr = dailyVolatilityPct({ volatilityAnnualizedPct: null, atrPct: 3.2 });
    expect(fromAtr).toBeCloseTo(2.0, 1);
  });

  it("returns null when neither measurement is available, so no floor gets invented", () => {
    expect(dailyVolatilityPct({ volatilityAnnualizedPct: null, atrPct: null })).toBeNull();
  });

  it("ignores zero and negative values rather than treating them as real measurements", () => {
    expect(dailyVolatilityPct({ volatilityAnnualizedPct: 0, atrPct: null })).toBeNull();
    expect(dailyVolatilityPct({ volatilityAnnualizedPct: -5, atrPct: null })).toBeNull();
  });

  it("clamps implausible readings into a sane band", () => {
    expect(dailyVolatilityPct({ volatilityAnnualizedPct: 0.01, atrPct: null })).toBe(0.25);
    expect(dailyVolatilityPct({ volatilityAnnualizedPct: 5000, atrPct: null })).toBe(12);
  });
});

describe("horizonVolatilityPct", () => {
  it("scales with the square root of time, not linearly", () => {
    const week = horizonVolatilityPct(2, "1_week");
    const quarter = horizonVolatilityPct(2, "3_month");
    expect(week).toBeCloseTo(2 * Math.sqrt(5), 5);
    expect(quarter).toBeCloseTo(2 * Math.sqrt(63), 5);

    // The regression this guards: a 1-week range is about a THIRD of a
    // 3-month range, not a twelfth. The old prompt asked for the latter.
    expect(week / quarter).toBeGreaterThan(0.25);
    expect(week / quarter).toBeLessThan(0.33);
  });

  it("recovers the annualized figure at the 12-month horizon", () => {
    const daily = 31.75 / Math.sqrt(252);
    expect(horizonVolatilityPct(daily, "12_month")).toBeCloseTo(31.75, 5);
  });
});

describe("typicalMovePct", () => {
  it("reports an ordinary weekly move far larger than v1 was predicting", () => {
    // v1's 1-week forecasts had a median predicted move of 0.50% while
    // the median actual move was 5.63%. The figure handed to the model
    // now reflects the real scale.
    const weekly = typicalMovePct(ORDINARY, "1_week");
    expect(weekly).not.toBeNull();
    expect(weekly as number).toBeGreaterThan(4);
  });

  it("is null when there is no volatility measurement", () => {
    expect(typicalMovePct({ volatilityAnnualizedPct: null, atrPct: null }, "1_week")).toBeNull();
  });

  it("produces one entry per horizon, increasing with time", () => {
    const all = typicalMoveByHorizonPct(ORDINARY);
    expect(all).not.toBeNull();
    const byHorizon = all as Record<keyof typeof TRADING_DAYS_BY_HORIZON, number>;
    expect(Object.keys(byHorizon).sort()).toEqual(Object.keys(TRADING_DAYS_BY_HORIZON).sort());
    expect(byHorizon["1_week"]).toBeLessThan(byHorizon["1_month"]);
    expect(byHorizon["1_month"]).toBeLessThan(byHorizon["3_month"]);
    expect(byHorizon["3_month"]).toBeLessThan(byHorizon["6_month"]);
    expect(byHorizon["6_month"]).toBeLessThan(byHorizon["12_month"]);
  });
});

describe("widenRangeToVolatility", () => {
  it("widens the pathologically narrow 1-week range v1 produced", () => {
    // Representative of the real failure: a $100 stock that moves ~2% a
    // day given a bear-to-bull range of 2%.
    const result = widenRangeToVolatility({
      scenarios: { bear: 99, base: 100, bull: 101 },
      currentPrice: 100,
      horizon: "1_week",
      volatility: ORDINARY,
    });

    expect(result.wasWidened).toBe(true);
    const widthPct = ((result.bull - result.bear) / 100) * 100;
    // 2.5 sigma over 5 trading days at ~2%/day is about 11%.
    expect(widthPct).toBeGreaterThan(10);
    expect(widthPct).toBeLessThan(12);
  });

  it("never moves the base case, so widening cannot change the direction call", () => {
    const result = widenRangeToVolatility({
      scenarios: { bear: 99, base: 100.4, bull: 101 },
      currentPrice: 100,
      horizon: "1_week",
      volatility: ORDINARY,
    });
    expect(result.base).toBe(100.4);
  });

  it("leaves a range that is already wide enough completely alone", () => {
    const scenarios = { bear: 70, base: 100, bull: 130 };
    const result = widenRangeToVolatility({
      scenarios,
      currentPrice: 100,
      horizon: "1_week",
      volatility: ORDINARY,
    });
    expect(result.wasWidened).toBe(false);
    expect(result).toMatchObject(scenarios);
  });

  it("applies no floor at all when volatility is unknown", () => {
    const scenarios = { bear: 99, base: 100, bull: 101 };
    const result = widenRangeToVolatility({
      scenarios,
      currentPrice: 100,
      horizon: "1_week",
      volatility: { volatilityAnnualizedPct: null, atrPct: null },
    });
    expect(result.wasWidened).toBe(false);
    expect(result.minWidthPct).toBeNull();
    expect(result).toMatchObject(scenarios);
  });

  it("enforces the stated number of standard deviations", () => {
    const currentPrice = 50;
    const result = widenRangeToVolatility({
      scenarios: { bear: 49.9, base: 50, bull: 50.1 },
      currentPrice,
      horizon: "1_month",
      volatility: ORDINARY,
    });
    const daily = 31.75 / Math.sqrt(252);
    const expectedWidthPct = MIN_RANGE_SIGMAS * daily * Math.sqrt(21);
    const actualWidthPct = ((result.bull - result.bear) / currentPrice) * 100;
    expect(actualWidthPct).toBeCloseTo(expectedWidthPct, 4);
  });

  it("keeps the model's asymmetry when it saw more room on one side", () => {
    // Base sits nearer the bull target, so most of the added width
    // belongs below.
    const result = widenRangeToVolatility({
      scenarios: { bear: 97, base: 100, bull: 101 },
      currentPrice: 100,
      horizon: "1_week",
      volatility: ORDINARY,
    });
    const addedBelow = 97 - result.bear;
    const addedAbove = result.bull - 101;
    expect(addedBelow).toBeGreaterThan(addedAbove);
  });

  it("does not let a degenerate range turn widening into a directional bet", () => {
    // Base exactly on the bear target: a naive proportional split would
    // put 100% of the extra width on the bull side and silently make
    // the forecast bullish.
    const result = widenRangeToVolatility({
      scenarios: { bear: 100, base: 100, bull: 101 },
      currentPrice: 100,
      horizon: "1_week",
      volatility: ORDINARY,
    });
    const addedBelow = 100 - result.bear;
    const addedAbove = result.bull - 101;
    expect(addedBelow).toBeGreaterThan(0);
    expect(addedAbove / (addedBelow + addedAbove)).toBeLessThanOrEqual(0.75 + 1e-9);
  });

  it("keeps the bear target above zero on a volatile stock at a long horizon", () => {
    const result = widenRangeToVolatility({
      scenarios: { bear: 9.9, base: 10, bull: 10.1 },
      currentPrice: 10,
      horizon: "12_month",
      volatility: { volatilityAnnualizedPct: 180, atrPct: null },
    });
    expect(result.bear).toBeGreaterThan(0);
    expect(result.bear).toBeLessThanOrEqual(result.base);
  });

  it("always returns bear <= base <= bull", () => {
    const cases = [
      { bear: 99, base: 100, bull: 101 },
      { bear: 100, base: 100, bull: 100 },
      { bear: 90, base: 95, bull: 96 },
    ];
    for (const scenarios of cases) {
      const result = widenRangeToVolatility({
        scenarios,
        currentPrice: 100,
        horizon: "1_week",
        volatility: ORDINARY,
      });
      expect(result.bear).toBeLessThanOrEqual(result.base);
      expect(result.base).toBeLessThanOrEqual(result.bull);
    }
  });
});
