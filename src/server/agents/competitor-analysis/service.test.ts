import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockSnapshot } from "@/lib/types";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { CompetitorAnalysisInterpretation } from "@/lib/competitor-types";

vi.mock("@/server/market-data", () => ({
  getStockSnapshot: vi.fn(),
  getPeerSymbols: vi.fn(),
}));

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretCompetitors: vi.fn(),
}));

const { getStockSnapshot, getPeerSymbols } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { interpretCompetitors } = await import("./interpreter");
const { runCompetitorAnalysis } = await import("./service");

function snapshot(ticker: string, companyName: string): StockSnapshot {
  return {
    ticker,
    companyName,
    quote: {
      ticker,
      price: 200,
      change: 1,
      changePercent: 0.5,
      dayHigh: 202,
      dayLow: 198,
      previousClose: 199,
      volume: 1_000_000,
      marketCap: 1_000_000_000_000,
      week52High: 220,
      week52Low: 150,
      avgVolume: 900_000,
      asOf: new Date().toISOString(),
    },
    history: [],
    period: "1M",
    provenance: { provider: "mock", isMock: true, fetchedAt: new Date().toISOString(), fromCache: false },
  };
}

function period(): FinancialPeriod {
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
  };
}

function fundamentalsResult() {
  const validated: ValidatedFinancialPeriod = { period: period(), warnings: [] };
  return { ok: true as const, data: { ticker: "AAPL", periodType: "annual" as const, periods: [validated], ratios: [], metricSeries: {} as never } };
}

const SAMPLE_INTERPRETATION: CompetitorAnalysisInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  competitiveScore: 30,
  confidenceScore: 0.7,
  competitorSelections: [],
  comparisonTable: [],
  whoIsWinning: "x",
  companyStrengths: [],
  companyWeaknesses: [],
  biggestCompetitiveThreat: "x",
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runCompetitorAnalysis", () => {
  it("identifies competitors via getPeerSymbols and computes metrics via getStockSnapshot/getFundamentals, never a provider directly", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockImplementation((ticker: string) =>
      Promise.resolve({ ok: true, data: snapshot(ticker, `${ticker} Inc.`) })
    );
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT", "GOOGL"] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runCompetitorAnalysis("AAPL");

    expect(getPeerSymbols).toHaveBeenCalledWith("AAPL", 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primaryCompany.ticker).toBe("AAPL");
      expect(result.data.competitors).toHaveLength(2);
    }
  });

  it("skips a candidate competitor whose quote data can't be fetched, rather than failing the whole analysis", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockImplementation((ticker: string) =>
      ticker === "BADTICKER"
        ? Promise.resolve({ ok: false, error: { code: "INVALID_TICKER", message: "bad" } })
        : Promise.resolve({ ok: true, data: snapshot(ticker, `${ticker} Inc.`) })
    );
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT", "BADTICKER"] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runCompetitorAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.competitors).toHaveLength(1);
      expect(result.data.competitors[0]!.ticker).toBe("MSFT");
    }
  });

  it("proceeds with zero competitors (not a failure) if peer identification fails entirely", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot("AAPL", "Apple Inc.") });
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runCompetitorAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.competitors).toEqual([]);
  });

  it("propagates a primary-company snapshot error without calling the interpreter", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runCompetitorAnalysis("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretCompetitors).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot("AAPL", "Apple Inc.") });
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretCompetitors as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runCompetitorAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runCompetitorAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getStockSnapshot).not.toHaveBeenCalled();
  });
});
