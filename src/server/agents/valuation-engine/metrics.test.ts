import { describe, expect, it } from "vitest";
import { calculateValuationMetrics } from "./metrics";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    ticker: "AAPL",
    price: 200,
    change: 1,
    changePercent: 0.5,
    dayHigh: 202,
    dayLow: 198,
    previousClose: 199,
    volume: 1_000_000,
    marketCap: 2_000_000_000_000,
    week52High: 220,
    week52Low: 150,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
    ...overrides,
  };
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
    revenue: 400_000_000_000,
    grossProfit: 180_000_000_000,
    operatingIncome: 120_000_000_000,
    netIncome: 100_000_000_000,
    eps: 6.5,
    cash: 30_000_000_000,
    totalAssets: 350_000_000_000,
    totalLiabilities: 250_000_000_000,
    totalDebt: 100_000_000_000,
    shareholdersEquity: 100_000_000_000,
    operatingCashFlow: 110_000_000_000,
    capitalExpenditures: -10_000_000_000,
    freeCashFlow: 100_000_000_000,
    ebitda: 140_000_000_000,
    dividendsPaid: -15_000_000_000,
    ...overrides,
  };
}

describe("calculateValuationMetrics", () => {
  it("computes P/E from price and eps", () => {
    const result = calculateValuationMetrics("AAPL", quote({ price: 130 }), period({ eps: 6.5 }), 10);
    expect(result.peRatio.value).toBeCloseTo(20, 5);
    expect(result.peRatio.unavailableReason).toBeNull();
  });

  it("marks P/E unavailable (with a reason) for negative or zero earnings, rather than a misleading number", () => {
    const negative = calculateValuationMetrics("AAPL", quote(), period({ eps: -1 }), 10);
    expect(negative.peRatio.value).toBeNull();
    expect(negative.peRatio.unavailableReason).toBeTruthy();

    const zero = calculateValuationMetrics("AAPL", quote(), period({ eps: 0 }), 10);
    expect(zero.peRatio.value).toBeNull();
  });

  it("computes PEG from P/E and earnings growth", () => {
    const result = calculateValuationMetrics("AAPL", quote({ price: 130 }), period({ eps: 6.5 }), 20);
    // P/E = 20, growth = 20 -> PEG = 1
    expect(result.pegRatio.value).toBeCloseTo(1, 5);
  });

  it("marks PEG unavailable when growth is negative or zero", () => {
    const result = calculateValuationMetrics("AAPL", quote({ price: 130 }), period({ eps: 6.5 }), -5);
    expect(result.pegRatio.value).toBeNull();
  });

  it("computes EV/EBITDA using enterprise value (market cap + net debt)", () => {
    const q = quote({ marketCap: 1_000_000_000_000 });
    const p = period({ totalDebt: 100_000_000_000, cash: 50_000_000_000, ebitda: 200_000_000_000 });
    const result = calculateValuationMetrics("AAPL", q, p, null);
    // EV = 1T + (100B - 50B) = 1.05T; EV/EBITDA = 1.05T / 200B = 5.25
    expect(result.evToEbitda.value).toBeCloseTo(5.25, 5);
  });

  it("marks EV/EBITDA unavailable when ebitda is missing or non-positive", () => {
    const result = calculateValuationMetrics("AAPL", quote(), period({ ebitda: null }), null);
    expect(result.evToEbitda.value).toBeNull();
  });

  it("computes Price/Sales and Price/Book from market cap", () => {
    const q = quote({ marketCap: 2_000_000_000_000 });
    const p = period({ revenue: 400_000_000_000, shareholdersEquity: 100_000_000_000 });
    const result = calculateValuationMetrics("AAPL", q, p, null);
    expect(result.priceToSales.value).toBeCloseTo(5, 5);
    expect(result.priceToBook.value).toBeCloseTo(20, 5);
  });

  it("marks Price/Book unavailable for negative shareholders equity", () => {
    const result = calculateValuationMetrics("AAPL", quote(), period({ shareholdersEquity: -1000 }), null);
    expect(result.priceToBook.value).toBeNull();
  });

  it("computes free cash flow yield and dividend yield as percentages", () => {
    const q = quote({ marketCap: 1_000_000_000_000 });
    const p = period({ freeCashFlow: 50_000_000_000, dividendsPaid: -20_000_000_000 });
    const result = calculateValuationMetrics("AAPL", q, p, null);
    expect(result.freeCashFlowYieldPct.value).toBeCloseTo(5, 5);
    expect(result.dividendYieldPct.value).toBeCloseTo(2, 5);
  });

  it("always marks forward P/E unavailable with an explicit reason (no forward-estimates data source)", () => {
    const result = calculateValuationMetrics("AAPL", quote(), period(), 10);
    expect(result.forwardPeRatio.value).toBeNull();
    expect(result.forwardPeRatio.unavailableReason).toBeTruthy();
  });

  it("marks every metric unavailable (not crashing) when there is no financial period at all", () => {
    const result = calculateValuationMetrics("AAPL", quote(), null, null);
    expect(result.peRatio.value).toBeNull();
    expect(result.evToEbitda.value).toBeNull();
    expect(result.priceToSales.value).toBeNull();
    expect(result.asOfPrice).toBe(quote().price);
  });
});
