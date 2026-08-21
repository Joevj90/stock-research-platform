import { describe, expect, it } from "vitest";
import { calculateFundamentalMetrics } from "./metrics";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

function period(fiscalYear: number, overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear,
    fiscalQuarter: null,
    reportingPeriodEnd: `${fiscalYear}-09-30T00:00:00.000Z`,
    filingDate: `${fiscalYear}-10-30T00:00:00.000Z`,
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

describe("calculateFundamentalMetrics", () => {
  it("computes growth rates period-over-period, with null for the first period", () => {
    const periods = [
      period(2023, { revenue: 100, netIncome: 20, eps: 1, freeCashFlow: 10 }),
      period(2024, { revenue: 120, netIncome: 25, eps: 1.2, freeCashFlow: 12 }),
      period(2025, { revenue: 150, netIncome: 30, eps: 1.5, freeCashFlow: 18 }),
    ];
    const result = calculateFundamentalMetrics("AAPL", periods);

    expect(result.revenueGrowthPct[0]).toBeNull();
    expect(result.revenueGrowthPct[1]).toBeCloseTo(20, 5);
    expect(result.revenueGrowthPct[2]).toBeCloseTo(25, 5);
    expect(result.earningsGrowthPct[1]).toBeCloseTo(25, 5);
    expect(result.epsGrowthPct[1]).toBeCloseTo(20, 5);
    expect(result.freeCashFlowGrowthPct[1]).toBeCloseTo(20, 5);
  });

  it("returns null growth when a value is missing on either side", () => {
    const periods = [
      period(2023, { revenue: 100 }),
      period(2024, { revenue: null }),
      period(2025, { revenue: 150 }),
    ];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.revenueGrowthPct[1]).toBeNull(); // 100 -> null
    expect(result.revenueGrowthPct[2]).toBeNull(); // null -> 150
  });

  it("computes margins by delegating to the Step 5 ratio function", () => {
    const periods = [period(2025, { revenue: 1000, grossProfit: 400, operatingIncome: 200, netIncome: 100 })];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.grossMarginPct[0]).toBeCloseTo(40, 5);
    expect(result.operatingMarginPct[0]).toBeCloseTo(20, 5);
    expect(result.netMarginPct[0]).toBeCloseTo(10, 5);
  });

  it("computes ROE from net income and shareholders equity", () => {
    const periods = [period(2025, { netIncome: 50, shareholdersEquity: 200 })];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.returnOnEquityPct[0]).toBeCloseTo(25, 5);
  });

  it("returns null ROE when shareholders equity is zero or missing", () => {
    const periods = [
      period(2025, { netIncome: 50, shareholdersEquity: 0 }),
      period(2026, { netIncome: 50, shareholdersEquity: null }),
    ];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.returnOnEquityPct[0]).toBeNull();
    expect(result.returnOnEquityPct[1]).toBeNull();
  });

  it("computes the simplified ROIC proxy from net income over debt+equity", () => {
    const periods = [period(2025, { netIncome: 60, totalDebt: 200, shareholdersEquity: 400 })];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.returnOnInvestedCapitalPct[0]).toBeCloseTo(10, 5); // 60/600*100
  });

  it("computes asset turnover as revenue / total assets", () => {
    const periods = [period(2025, { revenue: 500, totalAssets: 1000 })];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.assetTurnover[0]).toBeCloseTo(0.5, 5);
  });

  it("computes debt to operating cash flow", () => {
    const periods = [period(2025, { totalDebt: 100, operatingCashFlow: 25 })];
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.debtToOperatingCashFlow[0]).toBeCloseTo(4, 5);
  });

  it("computes earnings quality as operating cash flow / net income", () => {
    const strongQuality = [period(2025, { operatingCashFlow: 120, netIncome: 100 })];
    const weakQuality = [period(2025, { operatingCashFlow: 40, netIncome: 100 })];
    expect(calculateFundamentalMetrics("AAPL", strongQuality).earningsQualityRatio[0]).toBeCloseTo(1.2, 5);
    expect(calculateFundamentalMetrics("AAPL", weakQuality).earningsQualityRatio[0]).toBeCloseTo(0.4, 5);
  });

  it("never fabricates a value -- missing inputs produce null, not a guess", () => {
    const periods = [period(2025)]; // everything null
    const result = calculateFundamentalMetrics("AAPL", periods);
    expect(result.returnOnEquityPct[0]).toBeNull();
    expect(result.returnOnInvestedCapitalPct[0]).toBeNull();
    expect(result.assetTurnover[0]).toBeNull();
    expect(result.debtToOperatingCashFlow[0]).toBeNull();
    expect(result.earningsQualityRatio[0]).toBeNull();
    expect(result.grossMarginPct[0]).toBeNull();
  });

  it("carries through ticker, periodType, and fiscal years for context", () => {
    const periods = [period(2024, { periodType: "annual" }), period(2025, { periodType: "annual" })];
    const result = calculateFundamentalMetrics("MSFT", periods);
    expect(result.ticker).toBe("MSFT");
    expect(result.periodType).toBe("annual");
    expect(result.periodsAnalyzed).toBe(2);
    expect(result.fiscalYears).toEqual([2024, 2025]);
  });

  it("handles an empty periods array without throwing", () => {
    const result = calculateFundamentalMetrics("AAPL", []);
    expect(result.periodsAnalyzed).toBe(0);
    expect(result.revenueGrowthPct).toEqual([]);
  });
});
