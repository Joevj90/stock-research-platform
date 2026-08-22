import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockSnapshot } from "@/lib/types";
import type { RawForecastInterpretation } from "./interpreter";

vi.mock("@/server/market-data", () => ({ getStockSnapshot: vi.fn() }));
vi.mock("@/server/agents/technical-analysis", () => ({ runTechnicalAnalysis: vi.fn() }));
vi.mock("@/server/agents/fundamental-analyst", () => ({ runFundamentalAnalysis: vi.fn() }));
vi.mock("@/server/agents/valuation-engine", () => ({ runValuationAnalysis: vi.fn() }));
vi.mock("@/server/agents/sentiment-analysis", () => ({ runSentimentAnalysis: vi.fn() }));
vi.mock("@/server/agents/macro-analysis", () => ({ runMacroAnalysis: vi.fn() }));
vi.mock("@/server/agents/competitor-analysis", () => ({ runCompetitorAnalysis: vi.fn() }));
vi.mock("@/server/agents/management-analysis", () => ({ runManagementAnalysis: vi.fn() }));
vi.mock("@/server/agents/risk-analyst", () => ({ runRiskAnalysis: vi.fn() }));
vi.mock("./interpreter", () => ({ interpretForecast: vi.fn() }));

const { getStockSnapshot } = await import("@/server/market-data");
const { runTechnicalAnalysis } = await import("@/server/agents/technical-analysis");
const { runFundamentalAnalysis } = await import("@/server/agents/fundamental-analyst");
const { runValuationAnalysis } = await import("@/server/agents/valuation-engine");
const { runSentimentAnalysis } = await import("@/server/agents/sentiment-analysis");
const { runMacroAnalysis } = await import("@/server/agents/macro-analysis");
const { runCompetitorAnalysis } = await import("@/server/agents/competitor-analysis");
const { runManagementAnalysis } = await import("@/server/agents/management-analysis");
const { runRiskAnalysis } = await import("@/server/agents/risk-analyst");
const { interpretForecast } = await import("./interpreter");
const { runForecast } = await import("./service");

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

const VALID_SCENARIO = {
  explanation: "x",
  estimatedFinancialOutcome: "y",
  priceTarget: 210,
  probabilityPct: 50,
  mainReasons: [],
  keyRisks: [],
};

function horizon(h: "3_month" | "6_month" | "12_month") {
  return {
    horizon: h,
    dataSupportsThisHorizon: true,
    limitationNote: null,
    bear: { ...VALID_SCENARIO, priceTarget: 150, probabilityPct: 20 },
    base: { ...VALID_SCENARIO, priceTarget: 210, probabilityPct: 50 },
    bull: { ...VALID_SCENARIO, priceTarget: 280, probabilityPct: 30 },
    mostLikelyScenario: "base" as const,
  };
}

const SAMPLE_RAW_INTERPRETATION: RawForecastInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  horizons: [horizon("3_month"), horizon("6_month"), horizon("12_month")],
  keyCatalysts: [],
  keyRisksSummary: [],
  confidenceScore: 60,
  confidenceExplanation: "x",
  biggestOptimismReason: "x",
  biggestRiskReason: "y",
  assumptions: [],
  overallConclusion: "x",
};

const FAILURE = { ok: false as const, error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" } };

beforeEach(() => {
  vi.clearAllMocks();
  (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
});

describe("runForecast", () => {
  it("calls all 8 sub-agents in parallel via their real public barrels, never duplicating their logic", async () => {
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_RAW_INTERPRETATION });

    const result = await runForecast("AAPL");

    expect(runTechnicalAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runFundamentalAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runValuationAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runSentimentAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runMacroAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runCompetitorAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runManagementAnalysis).toHaveBeenCalledWith("AAPL");
    expect(runRiskAnalysis).toHaveBeenCalledWith("AAPL");
    expect(result.ok).toBe(true);
  });

  it("proceeds with the forecast even if every sub-agent fails, recording inputsUsed as all false", async () => {
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_RAW_INTERPRETATION });

    const result = await runForecast("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.inputsUsed).toEqual({
        technical: false,
        fundamental: false,
        valuation: false,
        sentiment: false,
        macro: false,
        competitor: false,
        management: false,
        risk: false,
      });
    }
  });

  it("records inputsUsed correctly when some sub-agents succeed and some fail", async () => {
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { interpretation: { trend: "uptrend", momentum: "bullish", technicalScore: 30, explanation: "x" } },
    });
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_RAW_INTERPRETATION });

    const result = await runForecast("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.inputsUsed.technical).toBe(true);
      expect(result.data.inputsUsed.fundamental).toBe(false);
    }
  });

  it("finalizes the interpretation with deterministic expectedPrice/expectedReturnPct filled in for every horizon", async () => {
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_RAW_INTERPRETATION });

    const result = await runForecast("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const h of result.data.interpretation.horizons) {
        expect(typeof h.expectedPrice).toBe("number");
        expect(typeof h.expectedReturnPct).toBe("number");
        // Every scenario's probabilities within a horizon must sum to exactly 100.
        expect(h.bear.probabilityPct + h.base.probabilityPct + h.bull.probabilityPct).toBe(100);
      }
    }
  });

  it("returns an error when no price data can be found for the ticker, even though sub-agents run in parallel with the snapshot fetch", async () => {
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);

    const result = await runForecast("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretForecast).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (runTechnicalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runFundamentalAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runValuationAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runSentimentAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runMacroAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runCompetitorAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runManagementAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (runRiskAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue(FAILURE);
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runForecast("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runForecast("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getStockSnapshot).not.toHaveBeenCalled();
  });

  it("uses precomputedGathered when provided, skipping the internal re-gather entirely", async () => {
    (interpretForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_RAW_INTERPRETATION });

    const precomputed = {
      companyName: "Apple Inc.",
      currentPrice: 199,
      inputsUsed: {
        technical: true,
        fundamental: false,
        valuation: false,
        sentiment: false,
        macro: false,
        competitor: false,
        management: false,
        risk: false,
      },
      summaries: {
        valuationDcfEstimates: null,
        technicalSummary: { trend: "uptrend", momentum: "bullish", technicalScore: 20, explanation: "x" },
        fundamentalSummary: null,
        sentimentSummary: null,
        macroSummary: null,
        competitorSummary: null,
        managementSummary: null,
        riskSummary: null,
      },
    };

    const result = await runForecast("AAPL", precomputed);

    expect(getStockSnapshot).not.toHaveBeenCalled();
    expect(runTechnicalAnalysis).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.currentPrice).toBe(199);
  });
});
