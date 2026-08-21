import { describe, expect, it } from "vitest";
import { computeCompanyMetricSet } from "./metrics";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";

function period(fiscalYear: number, overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
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
    revenue: 100,
    grossProfit: null,
    operatingIncome: null,
    netIncome: 20,
    eps: 2,
    cash: 10,
    totalAssets: null,
    totalLiabilities: null,
    totalDebt: 30,
    shareholdersEquity: 50,
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow: 17,
    ebitda: null,
    dividendsPaid: null,
    ...overrides,
  };
}

function quote(price: number, marketCap: number): Quote {
  return {
    ticker: "AAPL",
    price,
    change: 1,
    changePercent: 0.5,
    dayHigh: price + 1,
    dayLow: price - 1,
    previousClose: price - 1,
    volume: 1_000_000,
    marketCap,
    week52High: price + 20,
    week52Low: price - 20,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
  };
}

describe("computeCompanyMetricSet", () => {
  it("computes growth rates from the two most recent periods", () => {
    const periods = [
      period(2024, { revenue: 100, netIncome: 20, freeCashFlow: 15 }),
      period(2025, { revenue: 120, netIncome: 25, freeCashFlow: 18 }),
    ];
    const result = computeCompanyMetricSet("AAPL", "Apple Inc.", null, periods);
    expect(result.revenueGrowthPct).toBeCloseTo(20, 5);
    expect(result.earningsGrowthPct).toBeCloseTo(25, 5);
    expect(result.freeCashFlowGrowthPct).toBeCloseTo(20, 5);
  });

  it("computes net margin and ROE from the latest period", () => {
    const periods = [period(2025, { revenue: 1000, netIncome: 100, shareholdersEquity: 500 })];
    const result = computeCompanyMetricSet("AAPL", "Apple Inc.", null, periods);
    expect(result.netMarginPct).toBeCloseTo(10, 5);
    expect(result.returnOnEquityPct).toBeCloseTo(20, 5);
  });

  it("computes a simple P/E from price and eps", () => {
    const periods = [period(2025, { eps: 5 })];
    const result = computeCompanyMetricSet("AAPL", "Apple Inc.", quote(100, 1_000_000_000), periods);
    expect(result.peRatio).toBeCloseTo(20, 5);
  });

  it("carries market cap straight from the quote", () => {
    const result = computeCompanyMetricSet("AAPL", "Apple Inc.", quote(100, 2_500_000_000), []);
    expect(result.marketCap).toBe(2_500_000_000);
  });

  it("returns nulls (never a guess) for everything when there's no financial data", () => {
    const result = computeCompanyMetricSet("AAPL", "Apple Inc.", null, []);
    expect(result.revenue).toBeNull();
    expect(result.revenueGrowthPct).toBeNull();
    expect(result.netMarginPct).toBeNull();
    expect(result.returnOnEquityPct).toBeNull();
    expect(result.peRatio).toBeNull();
    expect(result.marketCap).toBeNull();
  });

  it("returns null P/E without a quote or with non-positive eps", () => {
    const periods = [period(2025, { eps: 2 })];
    expect(computeCompanyMetricSet("AAPL", null, null, periods).peRatio).toBeNull();
    expect(computeCompanyMetricSet("AAPL", null, quote(100, 1e9), [period(2025, { eps: 0 })]).peRatio).toBeNull();
  });

  it("returns null growth with fewer than two periods, without crashing", () => {
    const result = computeCompanyMetricSet("AAPL", null, null, [period(2025)]);
    expect(result.revenueGrowthPct).toBeNull();
  });

  it("carries the ticker and companyName through unchanged", () => {
    const result = computeCompanyMetricSet("MSFT", "Microsoft Corporation", null, []);
    expect(result.ticker).toBe("MSFT");
    expect(result.companyName).toBe("Microsoft Corporation");
  });
});
