import { describe, expect, it } from "vitest";
import { computeRiskSignals } from "./signals";
import type { PriceBar, Quote } from "@/lib/types";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { MacroIndicator } from "@/lib/macro-types";

function bar(close: number): PriceBar {
  return { timestamp: "2026-01-01T00:00:00.000Z", open: close, high: close, low: close, close, volume: 1000 };
}

function period(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear: 2025,
    fiscalQuarter: null,
    reportingPeriodEnd: "2025-09-30T00:00:00.000Z",
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: null,
    grossProfit: null,
    operatingIncome: null,
    netIncome: null,
    eps: null,
    cash: null,
    totalAssets: null,
    totalLiabilities: null,
    totalDebt: null,
    shareholdersEquity: null,
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow: null,
    ebitda: null,
    dividendsPaid: null,
    ...overrides,
  };
}

function quote(price: number): Quote {
  return {
    ticker: "AAPL",
    price,
    change: 1,
    changePercent: 0.5,
    dayHigh: price + 1,
    dayLow: price - 1,
    previousClose: price - 1,
    volume: 1_000_000,
    marketCap: 1_000_000_000_000,
    week52High: price + 20,
    week52Low: price - 20,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
  };
}

function macroIndicator(name: string, value: number): MacroIndicator {
  return { name, label: name, value, unit: "%", asOfDate: new Date().toISOString(), source: "FMP", url: null, retrievedAt: new Date().toISOString() };
}

describe("computeRiskSignals", () => {
  it("computes volatility using the shared annualizedVolatility function", () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(100 + Math.sin(i) * 10));
    const result = computeRiskSignals(bars, null, [], []);
    expect(result.volatilityAnnualizedPct).not.toBeNull();
    expect(result.volatilityAnnualizedPct!).toBeGreaterThan(0);
  });

  it("detects a decreasing revenue trend (a real risk signal)", () => {
    const periods = [period({ revenue: 100 }), period({ revenue: 80 })];
    const result = computeRiskSignals([], null, periods, []);
    expect(result.revenueGrowthTrend).toBe("decreasing");
    expect(result.revenueGrowthPct).toBeCloseTo(-20, 5);
  });

  it("computes net margin and its trend", () => {
    const periods = [
      period({ revenue: 1000, netIncome: 100 }), // 10%
      period({ revenue: 1000, netIncome: 50 }), // 5%
    ];
    const result = computeRiskSignals([], null, periods, []);
    expect(result.netMarginPct).toBeCloseTo(5, 5);
    expect(result.netMarginTrend).toBe("decreasing");
  });

  it("computes a debt-to-cash ratio as a liquidity risk reference point", () => {
    const periods = [period({ totalDebt: 200, cash: 50 })];
    const result = computeRiskSignals([], null, periods, []);
    expect(result.debtToCashRatio).toBeCloseTo(4, 5);
  });

  it("returns null debt-to-cash when cash is zero (avoids division by zero)", () => {
    const periods = [period({ totalDebt: 200, cash: 0 })];
    const result = computeRiskSignals([], null, periods, []);
    expect(result.debtToCashRatio).toBeNull();
  });

  it("computes a simple P/E from price and eps", () => {
    const periods = [period({ eps: 5 })];
    const result = computeRiskSignals([], quote(100), periods, []);
    expect(result.simplePeRatio).toBeCloseTo(20, 5);
  });

  it("passes through real macro indicators unmodified", () => {
    const indicators = [macroIndicator("CPI", 3.1)];
    const result = computeRiskSignals([], null, [], indicators);
    expect(result.macroIndicatorSummary).toEqual([{ name: "CPI", label: "CPI", value: 3.1, unit: "%" }]);
  });

  it("marks trends unavailable (never a guess) with fewer than two periods", () => {
    const result = computeRiskSignals([], null, [period()], []);
    expect(result.revenueGrowthTrend).toBe("unavailable");
    expect(result.totalDebtTrend).toBe("unavailable");
  });

  it("handles fully empty inputs without crashing", () => {
    const result = computeRiskSignals([], null, [], []);
    expect(result.source).toBe("calculated");
    expect(result.volatilityAnnualizedPct).toBeNull();
    expect(result.simplePeRatio).toBeNull();
  });
});
