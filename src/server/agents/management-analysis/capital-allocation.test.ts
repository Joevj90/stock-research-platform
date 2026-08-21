import { describe, expect, it } from "vitest";
import { computeCapitalAllocationSignal } from "./capital-allocation";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

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

describe("computeCapitalAllocationSignal", () => {
  it("detects an increasing dividend trend from real reported figures", () => {
    const periods = [period({ dividendsPaid: -10 }), period({ dividendsPaid: -15 })];
    const result = computeCapitalAllocationSignal(periods);
    expect(result.dividendsPaidTrend.direction).toBe("increasing");
    expect(result.dividendsPaidTrend.changePct).toBeCloseTo(50, 5);
  });

  it("detects a decreasing debt trend", () => {
    const periods = [period({ totalDebt: 100 }), period({ totalDebt: 80 })];
    const result = computeCapitalAllocationSignal(periods);
    expect(result.totalDebtTrend.direction).toBe("decreasing");
  });

  it("classifies a near-zero change as flat", () => {
    const periods = [period({ cash: 100 }), period({ cash: 100.5 })];
    const result = computeCapitalAllocationSignal(periods);
    expect(result.cashTrend.direction).toBe("flat");
  });

  it("infers a falling implied share count (buyback signal) from real netIncome/eps", () => {
    // Same net income, but EPS rose -- implies fewer shares outstanding.
    const periods = [
      period({ netIncome: 100, eps: 1 }), // implied shares = 100
      period({ netIncome: 100, eps: 1.25 }), // implied shares = 80
    ];
    const result = computeCapitalAllocationSignal(periods);
    expect(result.impliedSharesOutstandingTrend.direction).toBe("decreasing");
  });

  it("marks a trend unavailable (never a guess) when either period is missing the field", () => {
    const periods = [period({ totalDebt: null }), period({ totalDebt: 80 })];
    const result = computeCapitalAllocationSignal(periods);
    expect(result.totalDebtTrend.direction).toBe("unavailable");
    expect(result.totalDebtTrend.changePct).toBeNull();
  });

  it("marks every trend unavailable with fewer than two periods, without crashing", () => {
    const result = computeCapitalAllocationSignal([period()]);
    expect(result.dividendsPaidTrend.direction).toBe("unavailable");
    expect(result.totalDebtTrend.direction).toBe("unavailable");
    expect(result.impliedSharesOutstandingTrend.direction).toBe("unavailable");
  });

  it("handles an empty periods array without crashing", () => {
    const result = computeCapitalAllocationSignal([]);
    expect(result.source).toBe("calculated");
    expect(result.cashTrend.direction).toBe("unavailable");
  });
});
