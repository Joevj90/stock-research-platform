import { describe, expect, it } from "vitest";
import { computeFundamentalsSignal } from "./fundamentals-signal";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";

function period(fiscalYear: number, revenue: number, netIncome: number, eps: number): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear,
    fiscalQuarter: null,
    reportingPeriodEnd: `${fiscalYear}-09-30T00:00:00.000Z`,
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue,
    grossProfit: null,
    operatingIncome: null,
    netIncome,
    eps,
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

describe("computeFundamentalsSignal", () => {
  it("computes revenue and net income growth from the two most recent periods", () => {
    const periods = [period(2024, 100, 20, 2), period(2025, 120, 25, 2.5)];
    const result = computeFundamentalsSignal(periods, null);
    expect(result.latestRevenueGrowthPct).toBeCloseTo(20, 5);
    expect(result.latestNetIncomeGrowthPct).toBeCloseTo(25, 5);
  });

  it("computes a simple P/E from the latest period's eps and the current quote price", () => {
    const periods = [period(2025, 100, 20, 2)];
    const result = computeFundamentalsSignal(periods, quote(30));
    expect(result.simplePeRatio).toBeCloseTo(15, 5);
  });

  it("returns null P/E without a quote or with zero/negative eps", () => {
    const periods = [period(2025, 100, 20, 2)];
    expect(computeFundamentalsSignal(periods, null).simplePeRatio).toBeNull();
    expect(computeFundamentalsSignal([period(2025, 100, -5, -1)], quote(30)).simplePeRatio).toBeNull();
  });

  it("returns null growth with fewer than two periods, without crashing", () => {
    const result = computeFundamentalsSignal([period(2025, 100, 20, 2)], null);
    expect(result.latestRevenueGrowthPct).toBeNull();
    expect(result.latestNetIncomeGrowthPct).toBeNull();
  });

  it("handles an empty periods array without crashing", () => {
    const result = computeFundamentalsSignal([], null);
    expect(result.latestRevenueGrowthPct).toBeNull();
    expect(result.simplePeRatio).toBeNull();
  });
});
