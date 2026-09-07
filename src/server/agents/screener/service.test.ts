import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";

vi.mock("@/server/market-data", () => ({ getQuote: vi.fn() }));
vi.mock("@/server/fundamentals", () => ({ getFundamentals: vi.fn() }));

const { getQuote } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { scanValuationGapChunk } = await import("./service");

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

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    ticker: "AAPL",
    price: 150,
    change: 1,
    changePercent: 0.5,
    dayHigh: 151,
    dayLow: 149,
    previousClose: 149,
    volume: 1_000_000,
    marketCap: 2_000_000_000_000,
    week52High: 200,
    week52Low: 100,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function fundamentals(periods: FinancialPeriod[]) {
  return {
    ticker: periods[0]?.ticker ?? "AAPL",
    periodType: "annual" as const,
    periods: periods.map((p) => ({ period: p, warnings: [] })),
    ratios: [],
    metricSeries: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanValuationGapChunk", () => {
  it("computes a real DCF base fair value and implied upside for a ticker with good data", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote({ price: 100 }) });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: fundamentals([period({ fiscalYear: 2024, eps: 1.8 }), period({ fiscalYear: 2025, eps: 2 })]),
    });

    const result = await scanValuationGapChunk(["AAPL"]);

    expect(result.failedTickers).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.ticker).toBe("AAPL");
    expect(candidate.currentPrice).toBe(100);
    expect(candidate.baseFairValue).not.toBeNull();
    expect(candidate.impliedUpsidePct).not.toBeNull();
  });

  it("skips (never fabricates) a ticker whose quote fetch fails", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_UNREACHABLE", message: "x" } });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: fundamentals([period()]) });

    const result = await scanValuationGapChunk(["BADTICKER"]);

    expect(result.candidates).toEqual([]);
    expect(result.failedTickers).toEqual(["BADTICKER"]);
  });

  it("skips a ticker whose fundamentals fetch fails", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });

    const result = await scanValuationGapChunk(["NOPLAN"]);

    expect(result.candidates).toEqual([]);
    expect(result.failedTickers).toEqual(["NOPLAN"]);
  });

  it("skips a ticker with no financial periods at all", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: fundamentals([]) });

    const result = await scanValuationGapChunk(["EMPTY"]);

    expect(result.candidates).toEqual([]);
    expect(result.failedTickers).toEqual(["EMPTY"]);
  });

  it("processes multiple tickers concurrently and returns each independently", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockImplementation(async (ticker: string) => ({
      ok: true,
      data: quote({ ticker, price: 100 }),
    }));
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: fundamentals([period({ fiscalYear: 2024, eps: 1.8 }), period({ fiscalYear: 2025, eps: 2 })]),
    });

    const result = await scanValuationGapChunk(["AAA", "BBB", "CCC"]);

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => c.ticker).sort()).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("never fabricates a fair value when DCF math returns null (no derivable share count)", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: fundamentals([period({ netIncome: null, eps: null })]),
    });

    const result = await scanValuationGapChunk(["NOSHARES"]);

    expect(result.failedTickers).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.baseFairValue).toBeNull();
    expect(result.candidates[0]!.impliedUpsidePct).toBeNull();
  });

  it("catches a thrown error for one ticker without failing the rest of the chunk", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockImplementation(async (ticker: string) => {
      if (ticker === "THROWS") throw new Error("boom");
      return { ok: true, data: quote({ ticker, price: 100 }) };
    });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: fundamentals([period({ fiscalYear: 2024, eps: 1.8 }), period({ fiscalYear: 2025, eps: 2 })]),
    });

    const result = await scanValuationGapChunk(["THROWS", "FINE"]);

    expect(result.failedTickers).toEqual(["THROWS"]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.ticker).toBe("FINE");
  });
});
