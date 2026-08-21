import { describe, expect, it } from "vitest";
import { calculateTechnicalMetrics } from "./calculate";
import type { PriceBar } from "@/lib/types";

function makeBars(count: number, startPrice = 100): PriceBar[] {
  const bars: PriceBar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    price += Math.sin(i / 5) * 2 + 0.3; // gentle upward drift with wobble
    bars.push({
      timestamp: new Date(2025, 0, 1 + i).toISOString(),
      open: price - 0.5,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1_000_000 + (i % 7) * 100_000,
    });
  }
  return bars;
}

describe("calculateTechnicalMetrics", () => {
  it("marks the output with source: 'calculated' and echoes ticker/period", () => {
    const bars = makeBars(250);
    const result = calculateTechnicalMetrics("AAPL", "1Y", bars);

    expect(result.source).toBe("calculated");
    expect(result.ticker).toBe("AAPL");
    expect(result.period).toBe("1Y");
    expect(result.barsUsed).toBe(250);
  });

  it("fills every long-window indicator once there is enough history (250 bars)", () => {
    const bars = makeBars(250);
    const result = calculateTechnicalMetrics("AAPL", "1Y", bars);

    expect(result.sma20).not.toBeNull();
    expect(result.sma50).not.toBeNull();
    expect(result.sma100).not.toBeNull();
    expect(result.sma200).not.toBeNull();
    expect(result.ema20).not.toBeNull();
    expect(result.rsi14).not.toBeNull();
    expect(result.macd.line).not.toBeNull();
    expect(result.bollingerBands.middle).not.toBeNull();
    expect(result.atr14).not.toBeNull();
    expect(result.volatilityAnnualizedPct).not.toBeNull();
    expect(result.momentum.rateOfChange10Pct).not.toBeNull();
  });

  it("leaves long-window indicators null with too little history, without throwing", () => {
    const bars = makeBars(10);
    const result = calculateTechnicalMetrics("AAPL", "1M", bars);

    expect(result.sma50).toBeNull();
    expect(result.sma200).toBeNull();
    expect(result.barsUsed).toBe(10);
    expect(result.currentPrice).toBeGreaterThan(0);
  });

  it("sets currentPrice and asOf from the most recent bar", () => {
    const bars = makeBars(30);
    const result = calculateTechnicalMetrics("AAPL", "1M", bars);
    const last = bars[bars.length - 1]!;

    expect(result.currentPrice).toBe(last.close);
    expect(result.asOf).toBe(last.timestamp);
  });
});
