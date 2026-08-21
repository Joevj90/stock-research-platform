import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar, Quote } from "@/lib/types";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import type { SentimentInterpretation } from "@/lib/sentiment-types";

vi.mock("@/server/agents/news-intelligence", () => ({
  runNewsIntelligence: vi.fn(),
}));

vi.mock("@/server/market-data", () => ({
  getQuote: vi.fn(),
  getHistoricalPrices: vi.fn(),
}));

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretSentiment: vi.fn(),
}));

const { runNewsIntelligence } = await import("@/server/agents/news-intelligence");
const { getQuote, getHistoricalPrices } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { interpretSentiment } = await import("./interpreter");
const { runSentimentAnalysis } = await import("./service");

function newsResult(): NewsIntelligenceResult {
  return {
    ticker: "AAPL",
    fetchedAt: new Date().toISOString(),
    articles: [],
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      whatsHappening: { positive: ["Strong earnings"], negative: [], neutral: [] },
      importantEvents: [
        {
          primaryArticleUrl: "https://example.com/a",
          relatedArticleUrls: [],
          whatHappened: "x",
          whyItMatters: "y",
          possibleStockImpact: "z",
          timeHorizon: "short_term",
          timeHorizonExplanation: "days",
          importance: "high",
          classification: "bullish",
          recencyType: "recent_event",
        },
      ],
    },
  };
}

function quote(): Quote {
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
  };
}

function bars(): PriceBar[] {
  return Array.from({ length: 15 }, (_, i) => ({
    timestamp: `2026-08-${i + 1}T00:00:00.000Z`,
    open: 190 + i,
    high: 195 + i,
    low: 185 + i,
    close: 190 + i,
    volume: 1_000_000,
  }));
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

function fundamentalsResult() {
  const validated: ValidatedFinancialPeriod = { period: period(), warnings: [] };
  return { ok: true as const, data: { ticker: "AAPL", periodType: "annual" as const, periods: [validated], ratios: [], metricSeries: {} as never } };
}

const SAMPLE_INTERPRETATION: SentimentInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  sentimentScore: 40,
  sentimentDirection: "bullish",
  confidenceScore: 0.7,
  positiveFactors: [],
  negativeFactors: [],
  majorSentimentDrivers: [],
  sentimentTrend: "improving",
  sentimentTrendExplanation: "x",
  marketReaction: { whatIsHappening: "x", why: "y", whyItMatters: "z" },
  sentimentVsFundamentals: { whatIsHappening: "x", why: "y", whyItMatters: "z" },
  sentimentVsValuation: { whatIsHappening: "x", why: "y", whyItMatters: "z" },
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSentimentAnalysis", () => {
  it("builds on Step 7's already-classified news events rather than re-fetching raw articles", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretSentiment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runSentimentAnalysis("AAPL");

    expect(runNewsIntelligence).toHaveBeenCalledWith("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.newsEventCount).toBe(1);
  });

  it("passes the already-classified events and real signals to the interpreter", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretSentiment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    await runSentimentAnalysis("AAPL");

    const call = (interpretSentiment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.newsEvents).toHaveLength(1);
    expect(call.marketReaction.source).toBe("calculated");
    expect(call.fundamentalsSignal.source).toBe("calculated");
  });

  it("propagates a news-intelligence error without calling the interpreter", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runSentimentAnalysis("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretSentiment).not.toHaveBeenCalled();
  });

  it("degrades gracefully (nulls, not failure) when market data or fundamentals are unavailable", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });
    (interpretSentiment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runSentimentAnalysis("AAPL");
    expect(result.ok).toBe(true); // news alone is still enough to proceed
    if (result.ok) {
      expect(result.data.marketReaction.recentPriceChangePct).toBeNull();
      expect(result.data.fundamentalsSignal.latestRevenueGrowthPct).toBeNull();
    }
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (interpretSentiment as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runSentimentAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runSentimentAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(runNewsIntelligence).not.toHaveBeenCalled();
  });
});
