import { describe, expect, it } from "vitest";
import { computeFinancialRatios } from "./ratios";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

function period(overrides: Partial<FinancialPeriod>): FinancialPeriod {
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

describe("computeFinancialRatios", () => {
  it("computes margins as percentages", () => {
    const p = period({ revenue: 1000, grossProfit: 400, operatingIncome: 200, netIncome: 100 });
    const ratios = computeFinancialRatios(p);
    expect(ratios.grossMarginPct).toBeCloseTo(40, 5);
    expect(ratios.operatingMarginPct).toBeCloseTo(20, 5);
    expect(ratios.netMarginPct).toBeCloseTo(10, 5);
  });

  it("computes debt-to-equity as a ratio", () => {
    const p = period({ totalDebt: 50, shareholdersEquity: 100 });
    const ratios = computeFinancialRatios(p);
    expect(ratios.debtToEquity).toBeCloseTo(0.5, 5);
  });

  it("returns null rather than dividing by zero", () => {
    const p = period({ revenue: 0, grossProfit: 100, totalDebt: 50, shareholdersEquity: 0 });
    const ratios = computeFinancialRatios(p);
    expect(ratios.grossMarginPct).toBeNull();
    expect(ratios.debtToEquity).toBeNull();
  });

  it("returns null when an input is missing, never a guessed value", () => {
    const p = period({ revenue: 1000, grossProfit: null });
    const ratios = computeFinancialRatios(p);
    expect(ratios.grossMarginPct).toBeNull();
  });
});
