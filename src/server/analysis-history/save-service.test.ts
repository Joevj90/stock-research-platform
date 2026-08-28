import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalReportResult } from "@/lib/final-report-types";
import type { ForecastResult, ScenarioOutcome } from "@/lib/forecast-types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    savedAnalysis: { create: vi.fn() },
  },
}));

const { prisma } = await import("@/server/db/client");
const { saveAnalysis } = await import("./save-service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

function scenario(overrides: Partial<ScenarioOutcome> = {}): ScenarioOutcome {
  return {
    scenario: "base",
    explanation: "x",
    estimatedFinancialOutcome: "x",
    priceTarget: 210,
    expectedReturnPct: 5,
    probabilityPct: 50,
    mainReasons: [],
    keyRisks: [],
    ...overrides,
  };
}

function report(): FinalReportResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    quickAnswer: {
      rating: "buy",
      currentPrice: 200,
      expectedPrice: 220,
      expectedReturnPct: 10,
      expectedReturnHorizon: "12_month",
      confidenceScore: 70,
      explanation: "The committee is optimistic.",
    },
    whyAiLikesIt: [],
    whyAiIsWorried: [],
    bearBaseBull: {
      bear: scenario({ scenario: "bear", priceTarget: 150, probabilityPct: 20 }),
      base: scenario(),
      bull: scenario({ scenario: "bull", priceTarget: 280, probabilityPct: 30 }),
      expectedPrice: 220,
      expectedReturnPct: 10,
    },
    forecastHorizons: [
      { horizon: "3_month", expectedPrice: 205, expectedReturnPct: 2.5 },
      { horizon: "6_month", expectedPrice: 212, expectedReturnPct: 6 },
      { horizon: "12_month", expectedPrice: 220, expectedReturnPct: 10 },
    ],
    businessQuality: {
      financialHealth: "strong",
      growth: "good",
      profitability: "good",
      competitivePosition: "strong",
      management: "average",
      businessRisks: "average",
      explanation: "x",
    },
    valuation: { rating: "reasonably_priced", explanation: "Fairly priced relative to peers." },
    whatsHappeningNow: {
      summary: { positive: [], negative: [], neutral: [] },
      topEvents: [{ headline: "Big news", url: "https://example.com/a", source: "Reuters", whatHappened: "x", whyItMatters: "y" }],
    },
    marketSentiment: { direction: "bullish", trend: "improving", whatInvestorsLike: [], whatInvestorsAreWorriedAbout: [] },
    economy: { environment: "neutral", explanation: "x" },
    competition: { isWinning: "Apple appears to be winning.", majorCompetitors: [] },
    management: { assessment: "good", credibilityExplanation: "x", capitalAllocationAssessment: "y", concerns: [] },
    biggestRisks: [{ risk: "Slowing growth", evidence: "x", severity: "medium", probability: "medium", potentialImpact: "x", timeFrame: "medium_term", whatWouldConfirmIt: "x", whatWouldReduceIt: "x" }],
    devilsAdvocate: { whatCouldWeBeMissing: [], strongestArgumentAgainst: "x", didItChangeAnything: false, whatChanged: null },
    whatWouldChangeAiMind: { moreBearishIf: [], lessWorriedIf: [] },
    finalConclusion: { bottomLine: "Overall positive.", rating: "buy", confidenceScore: 70, expectedReturnPct: 10, expectedReturnHorizon: "12_month" },
    dataConsistencyNotes: [],
    sources: [{ label: "Big news", url: "https://example.com/a" }],
  };
}

function forecast(): ForecastResult {
  const horizon = {
    horizon: "12_month" as const,
    dataSupportsThisHorizon: true,
    limitationNote: null,
    bear: scenario({ scenario: "bear", priceTarget: 150, probabilityPct: 20 }),
    base: scenario(),
    bull: scenario({ scenario: "bull", priceTarget: 280, probabilityPct: 30 }),
    expectedPrice: 220,
    expectedReturnPct: 10,
    mostLikelyScenario: "base" as const,
  };
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    currentPrice: 200,
    generatedAt: new Date().toISOString(),
    inputsUsed: {
      technical: false, fundamental: false, valuation: false, sentiment: false,
      macro: false, competitor: false, management: false, risk: false,
    },
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      horizons: [horizon, horizon, horizon],
      keyCatalysts: [{ whatCouldHappen: "New product launch", whyItWouldHelp: "x", importance: "high" }],
      keyRisksSummary: [],
      confidenceScore: 70,
      confidenceExplanation: "x",
      biggestOptimismReason: "x",
      biggestRiskReason: "x",
      assumptions: [{ assumption: "Growth continues", explanation: "x" }],
      overallConclusion: "x",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("saveAnalysis", () => {
  it("always CREATEs a new row -- never updates an existing one, preserving history", async () => {
    (prisma.savedAnalysis.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sa_1",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      analysisDate: new Date(),
      priceAtAnalysis: 200,
      rating: "buy",
      confidenceScore: 70,
      bearPrice: 150,
      basePrice: 210,
      bullPrice: 280,
      expectedPrice: 220,
      expectedReturnPct: 10,
      bearProbabilityPct: 20,
      baseProbabilityPct: 50,
      bullProbabilityPct: 30,
      valuationConclusion: "x",
      sentimentConclusion: "x",
      macroConclusion: "x",
      competitorConclusion: "x",
      managementConclusion: "x",
      committeeConclusion: "x",
      devilsAdvocateConclusion: "x",
      bottomLine: "x",
      majorAssumptions: "[]",
      majorRisks: "[]",
      majorCatalysts: "[]",
      keyNewsFindings: "[]",
    });

    await saveAnalysis("AAPL", report(), forecast());

    expect(prisma.savedAnalysis.create).toHaveBeenCalledTimes(1);
    // Prisma's client has no top-level "update" method invoked anywhere in this module.
  });

  it("pulls real assumptions and catalysts from the Forecast, since Final Report doesn't carry them directly", async () => {
    (prisma.savedAnalysis.create as ReturnType<typeof vi.fn>).mockImplementation(({ data }) => Promise.resolve({ ...data, id: "sa_1", analysisDate: new Date() }));

    const result = await saveAnalysis("AAPL", report(), forecast());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.majorAssumptions).toEqual(["Growth continues"]);
      expect(result.data.majorCatalysts).toEqual(["New product launch"]);
    }
  });

  it("stores the real bottom line and rating from the report, unmodified", async () => {
    (prisma.savedAnalysis.create as ReturnType<typeof vi.fn>).mockImplementation(({ data }) => Promise.resolve({ ...data, id: "sa_1", analysisDate: new Date() }));

    const result = await saveAnalysis("AAPL", report(), forecast());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bottomLine).toBe("Overall positive.");
      expect(result.data.rating).toBe("buy");
      expect(result.data.priceAtAnalysis).toBe(200);
    }
  });

  it("never throws, even if the database write fails -- saving must not break the user-facing report", async () => {
    (prisma.savedAnalysis.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));

    const result = await saveAnalysis("AAPL", report(), forecast());
    expect(result.ok).toBe(false);
  });
});
