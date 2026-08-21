import { describe, expect, it } from "vitest";
import { computeHistoricalComparison } from "./historical";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { PriceBar } from "@/lib/types";

function bar(timestamp: string, close: number): PriceBar {
  return { timestamp, open: close, high: close, low: close, close, volume: 1000 };
}

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
    revenue: 100_000_000_000,
    grossProfit: 40_000_000_000,
    operatingIncome: 25_000_000_000,
    netIncome: 20_000_000_000,
    eps: 2,
    cash: 10_000_000_000,
    totalAssets: 200_000_000_000,
    totalLiabilities: 100_000_000_000,
    totalDebt: 30_000_000_000,
    shareholdersEquity: 100_000_000_000,
    operatingCashFlow: 22_000_000_000,
    capitalExpenditures: -5_000_000_000,
    freeCashFlow: 17_000_000_000,
    ebitda: 30_000_000_000,
    dividendsPaid: -3_000_000_000,
    ...overrides,
  };
}

describe("computeHistoricalComparison", () => {
  it("finds the nearest historical price to each period's reporting date and computes P/E", () => {
    const bars = [bar("2023-09-30T00:00:00.000Z", 40), bar("2024-09-30T00:00:00.000Z", 60)];
    const periods = [period(2023, { eps: 2 }), period(2024, { eps: 3 })];

    const result = computeHistoricalComparison(bars, periods, null, null);

    expect(result.points[0]!.peRatio).toBeCloseTo(20, 5); // 40/2
    expect(result.points[1]!.peRatio).toBeCloseTo(20, 5); // 60/3
  });

  it("computes current-vs-historical-average as a percentage", () => {
    const bars = [bar("2023-09-30T00:00:00.000Z", 20), bar("2024-09-30T00:00:00.000Z", 20)];
    const periods = [period(2023, { eps: 2 }), period(2024, { eps: 2 })]; // historical P/E = 10 both years

    const result = computeHistoricalComparison(bars, periods, 15, null); // current P/E = 15
    expect(result.currentPeVsHistoricalAveragePct).toBeCloseTo(50, 5); // 50% more expensive than history
  });

  it("returns null P/E for a period with negative or zero eps, without crashing", () => {
    const bars = [bar("2023-09-30T00:00:00.000Z", 40)];
    const periods = [period(2023, { eps: -1 })];
    const result = computeHistoricalComparison(bars, periods, null, null);
    expect(result.points[0]!.peRatio).toBeNull();
  });

  it("returns null comparison percentages when there is no historical data or no current metric", () => {
    const result = computeHistoricalComparison([], [], null, null);
    expect(result.currentPeVsHistoricalAveragePct).toBeNull();
    expect(result.points).toEqual([]);
  });

  it("handles an empty price history without crashing", () => {
    const periods = [period(2023)];
    const result = computeHistoricalComparison([], periods, 15, null);
    expect(result.points[0]!.peRatio).toBeNull();
  });
});
