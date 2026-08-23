import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockSnapshot } from "@/lib/types";
import type { NewsIntelligenceResult } from "@/lib/news-types";

vi.mock("@/server/market-data", () => ({ getStockSnapshot: vi.fn() }));
vi.mock("@/server/agents/technical-analysis", () => ({ runTechnicalAnalysis: vi.fn() }));
vi.mock("@/server/agents/fundamental-analyst", () => ({ runFundamentalAnalysis: vi.fn() }));
vi.mock("@/server/agents/valuation-engine", () => ({ runValuationAnalysis: vi.fn() }));
vi.mock("@/server/agents/sentiment-analysis", () => ({ runSentimentAnalysis: vi.fn() }));
vi.mock("@/server/agents/macro-analysis", () => ({ runMacroAnalysis: vi.fn() }));
vi.mock("@/server/agents/competitor-analysis", () => ({ runCompetitorAnalysis: vi.fn() }));
vi.mock("@/server/agents/management-analysis", () => ({ runManagementAnalysis: vi.fn() }));
vi.mock("@/server/agents/risk-analyst", () => ({ runRiskAnalysis: vi.fn() }));
vi.mock("@/server/agents/news-intelligence", () => ({ runNewsIntelligence: vi.fn() }));

const { getStockSnapshot } = await import("@/server/market-data");
const { runTechnicalAnalysis } = await import("@/server/agents/technical-analysis");
const { runFundamentalAnalysis } = await import("@/server/agents/fundamental-analyst");
const { runValuationAnalysis } = await import("@/server/agents/valuation-engine");
const { runSentimentAnalysis } = await import("@/server/agents/sentiment-analysis");
const { runMacroAnalysis } = await import("@/server/agents/macro-analysis");
const { runCompetitorAnalysis } = await import("@/server/agents/competitor-analysis");
const { runManagementAnalysis } = await import("@/server/agents/management-analysis");
const { runRiskAnalysis } = await import("@/server/agents/risk-analyst");
const { runNewsIntelligence } = await import("@/server/agents/news-intelligence");
const { gatherAnalysisSummaries } = await import("./analysis-summaries");

const FAILURE = { ok: false as const, error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" } };

function snapshot(): StockSnapshot {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    quote: {
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
    },
    history: [],
    period: "1M",
    provenance: { provider: "mock", isMock: true, fetchedAt: new Date().toISOString(), fromCache: false },
  };
}

function newsResult(): NewsIntelligenceResult {
  return {
    ticker: "AAPL",
    fetchedAt: new Date().toISOString(),
    articles: [],
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      whatsHappening: { positive: [], negative: [], neutral: [] },
      importantEvents: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
  (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
  (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
});

describe("gatherAnalysisSummaries", () => {
  it("fetches News Intelligence exactly once, not once per consumer", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });

    await gatherAnalysisSummaries("AAPL");

    expect(runNewsIntelligence).toHaveBeenCalledTimes(1);
  });

  it("passes the SAME news result into both Sentiment Analysis and Risk Analyst, rather than each fetching independently", async () => {
    const news = { ok: true as const, data: newsResult() };
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue(news);

    await gatherAnalysisSummaries("AAPL");

    expect(runSentimentAnalysis).toHaveBeenCalledWith("AAPL", news);
    expect(runRiskAnalysis).toHaveBeenCalledWith("AAPL", news);
  });

  it("exposes the fetched news result in full.news for callers that need real article detail (e.g. the Final Report)", async () => {
    const news = newsResult();
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: news });

    const result = await gatherAnalysisSummaries("AAPL");

    expect(result.full.news).toEqual(news);
  });

  it("sets full.news to null (never fabricated) when News Intelligence fails", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);

    const result = await gatherAnalysisSummaries("AAPL");

    expect(result.full.news).toBeNull();
  });

  it("does not let a News Intelligence failure prevent the other 6 independent agents from contributing", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { interpretation: {} } });

    const result = await gatherAnalysisSummaries("AAPL");

    expect(runTechnicalAnalysis).toHaveBeenCalled();
    expect(result.inputsUsed.technical).toBe(true);
  });
});
