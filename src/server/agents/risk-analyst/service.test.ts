import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote, StockSnapshot } from "@/lib/types";
import type { ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import type { RiskInterpretation } from "@/lib/risk-types";

vi.mock("@/server/market-data", () => ({
  getQuote: vi.fn(),
  getHistoricalPrices: vi.fn(),
  getStockSnapshot: vi.fn(),
}));

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("@/server/macro", () => ({
  getMacroIndicators: vi.fn(),
}));

vi.mock("@/server/agents/news-intelligence", () => ({
  runNewsIntelligence: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretRisk: vi.fn(),
}));

const { getQuote, getHistoricalPrices, getStockSnapshot } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { getMacroIndicators } = await import("@/server/macro");
const { runNewsIntelligence } = await import("@/server/agents/news-intelligence");
const { interpretRisk } = await import("./interpreter");
const { runRiskAnalysis } = await import("./service");

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

function snapshot(): StockSnapshot {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    quote: quote(),
    history: [],
    period: "1M",
    provenance: { provider: "mock", isMock: true, fetchedAt: new Date().toISOString(), fromCache: false },
  };
}

function newsResult(events: NewsIntelligenceResult["interpretation"]["importantEvents"] = []): NewsIntelligenceResult {
  return {
    ticker: "AAPL",
    fetchedAt: new Date().toISOString(),
    articles: [],
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      whatsHappening: { positive: [], negative: [], neutral: [] },
      importantEvents: events,
    },
  };
}

function bullishEvent() {
  return {
    primaryArticleUrl: "https://example.com/a",
    relatedArticleUrls: [],
    whatHappened: "x",
    whyItMatters: "y",
    possibleStockImpact: "z",
    timeHorizon: "short_term" as const,
    timeHorizonExplanation: "days",
    importance: "low" as const,
    classification: "bullish" as const,
    recencyType: "recent_event" as const,
  };
}

function bearishEvent() {
  return { ...bullishEvent(), classification: "bearish" as const, importance: "high" as const };
}

const SAMPLE_INTERPRETATION: RiskInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  riskScore: 40,
  riskLevel: "medium",
  confidenceScore: 0.6,
  biggestRisks: [],
  numberOneRisk: {
    risk: "x",
    evidence: "y",
    severity: "medium",
    probability: "medium",
    potentialImpact: "z",
    timeFrame: "medium_term",
    whatWouldConfirmIt: "a",
    whatWouldReduceIt: "b",
  },
  whatWouldMakeMoreBearish: [],
  whatWouldMakeLessWorried: [],
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRiskAnalysis", () => {
  it("fetches data via existing public barrels only, never a provider directly", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { periods: [] as ValidatedFinancialPeriod[] } });
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretRisk as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runRiskAnalysis("AAPL");

    expect(runNewsIntelligence).toHaveBeenCalledWith("AAPL");
    expect(result.ok).toBe(true);
  });

  it("filters news events down to bearish or high/very_high importance only", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { periods: [] as ValidatedFinancialPeriod[] } });
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: newsResult([bullishEvent(), bearishEvent()]),
    });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretRisk as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runRiskAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.newsEvidenceCount).toBe(1);

    const call = (interpretRisk as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.bearishNewsEvents).toHaveLength(1);
  });

  it("degrades gracefully when price/fundamentals/macro data is unavailable, still using news", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: "PROVIDER_PLAN_REQUIRED", message: "x" } });
    (interpretRisk as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runRiskAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.signals.volatilityAnnualizedPct).toBeNull();
      expect(result.data.companyName).toBeNull();
    }
  });

  it("propagates a news-intelligence error without calling the interpreter", async () => {
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runRiskAnalysis("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretRisk).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { periods: [] as ValidatedFinancialPeriod[] } });
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (runNewsIntelligence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: newsResult() });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretRisk as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runRiskAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runRiskAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(runNewsIntelligence).not.toHaveBeenCalled();
  });
});
