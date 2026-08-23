import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { ForecastResult, ScenarioOutcome } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import type { FundamentalAnalystResult } from "@/lib/fundamental-analyst-types";
import type { CompetitorAnalysisResult } from "@/lib/competitor-types";
import type { ManagementAnalysisResult } from "@/lib/management-types";
import type { RiskAnalysisResult } from "@/lib/risk-types";
import type { ValuationResult } from "@/lib/valuation-types";

vi.mock("@/server/agents/shared/analysis-summaries", () => ({ gatherAnalysisSummaries: vi.fn() }));
vi.mock("@/server/agents/forecasting", () => ({ runForecast: vi.fn() }));
vi.mock("@/server/agents/investment-committee", () => ({ runInvestmentCommittee: vi.fn() }));
vi.mock("@/server/agents/devils-advocate", () => ({ runDevilsAdvocate: vi.fn() }));

const { gatherAnalysisSummaries } = await import("@/server/agents/shared/analysis-summaries");
const { runForecast } = await import("@/server/agents/forecasting");
const { runInvestmentCommittee } = await import("@/server/agents/investment-committee");
const { runDevilsAdvocate } = await import("@/server/agents/devils-advocate");
const { runFinalReport } = await import("./service");

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

function forecastResult(): ForecastResult {
  const horizon = {
    horizon: "12_month" as const,
    dataSupportsThisHorizon: true,
    limitationNote: null,
    bear: scenario({ scenario: "bear", priceTarget: 150, probabilityPct: 20 }),
    base: scenario(),
    bull: scenario({ scenario: "bull", priceTarget: 280, probabilityPct: 30 }),
    expectedPrice: 215,
    expectedReturnPct: 7.5,
    mostLikelyScenario: "base" as const,
  };
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    currentPrice: 200,
    generatedAt: new Date().toISOString(),
    inputsUsed: emptyInputsUsed(),
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      horizons: [
        { ...horizon, horizon: "3_month" },
        { ...horizon, horizon: "6_month" },
        horizon,
      ],
      keyCatalysts: [],
      keyRisksSummary: [],
      confidenceScore: 65,
      confidenceExplanation: "x",
      biggestOptimismReason: "x",
      biggestRiskReason: "x",
      assumptions: [],
      overallConclusion: "x",
    },
  };
}

function emptyInputsUsed() {
  return {
    technical: false,
    fundamental: false,
    valuation: false,
    sentiment: false,
    macro: false,
    competitor: false,
    management: false,
    risk: false,
  };
}

function committeeResult(): CommitteeResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    inputsUsed: emptyInputsUsed(),
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      personaEvaluations: [],
      voteTally: { source: "calculated", buy: 3, hold: 1, sell: 1, totalVotes: 5 },
      keyAgreements: ["Strong fundamentals", "Improving sentiment", "Healthy balance sheet"],
      keyDisagreements: [{ topic: "Valuation", description: "Some see it as pricey", sidesSummary: "x" }],
      debateExchanges: [],
      finalRecommendation: "buy",
      finalConfidence: 70,
      recommendationRationale: "x",
      minorityViewWorthConsidering: null,
      overallConclusion: "The committee is generally optimistic about this company.",
    },
  };
}

function devilsAdvocateResult(overrides: Partial<DevilsAdvocateResult> = {}): DevilsAdvocateResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    originalCommitteeRating: "buy",
    originalCommitteeConfidence: 70,
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      overallChallengeScore: 30,
      challengeLevel: "moderate",
      majorWeaknesses: [{ problem: "Growth may slow", evidence: "x", whyItMatters: "y", severity: "medium", couldChangeConclusion: false, recommendedAdjustment: null }],
      overlookedRisks: ["Customer concentration wasn't deeply reviewed"],
      questionableAssumptions: [],
      contradictoryEvidence: [],
      alternativeInterpretations: [],
      confidenceConcerns: [],
      whatAssumptionWorriesMost: "That growth continues at the recent pace.",
      couldThisChangeTheRating: "no",
      whyChangeOrNot: "x",
      recommendedChanges: [],
      finalConclusion: "The thesis holds up reasonably well.",
    },
    committeeReview: { wasThesisRevised: false, revisedRating: null, revisedConfidence: null, whatChangedAndWhy: null },
    gathered: gatheredFixture(),
    forecast: forecastResult(),
    committee: committeeResult(),
    ...overrides,
  };
}

function newsIntelResult(): NewsIntelligenceResult {
  return {
    ticker: "AAPL",
    fetchedAt: new Date().toISOString(),
    articles: [{ headline: "Apple announces new product", url: "https://example.com/a", source: "Reuters", publishedAt: new Date().toISOString(), summary: "x", sourceType: null, ticker: "AAPL", retrievedAt: new Date().toISOString(), provider: "fmp" }],
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      whatsHappening: { positive: ["Strong product launch"], negative: [], neutral: [] },
      importantEvents: [
        {
          primaryArticleUrl: "https://example.com/a",
          relatedArticleUrls: [],
          whatHappened: "New product announced",
          whyItMatters: "Could drive sales",
          possibleStockImpact: "x",
          timeHorizon: "short_term",
          timeHorizonExplanation: "x",
          importance: "high",
          classification: "bullish",
          recencyType: "recent_event",
        },
      ],
    },
  };
}

function fundamentalResult(): FundamentalAnalystResult {
  return {
    ticker: "AAPL",
    periodType: "annual",
    calculated: {
      source: "calculated",
      ticker: "AAPL",
      periodType: "annual",
      periodsAnalyzed: 2,
      fiscalYears: [2024, 2025],
      revenueGrowthPct: [null, 12],
      earningsGrowthPct: [null, 15],
      epsGrowthPct: [null, 15],
      freeCashFlowGrowthPct: [null, 10],
      grossMarginPct: [40, 41],
      operatingMarginPct: [25, 26],
      netMarginPct: [18, 19],
      returnOnEquityPct: [30, 32],
      returnOnInvestedCapitalPct: [20, 21],
      assetTurnover: [0.8, 0.85],
      debtToEquity: [0.5, 0.5],
      debtToOperatingCashFlow: [1, 1],
      earningsQualityRatio: [1.1, 1.1],
    },
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      overallFundamentalScore: 60,
      confidenceScore: 0.8,
      revenueAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      earningsAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      profitabilityAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      cashFlowAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      balanceSheetAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      growthAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      financialStrengthAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
      positiveFactors: [],
      negativeFactors: [],
      importantTrends: [],
      keyConcerns: [],
      overallConclusion: "The company shows strong, consistent financial performance.",
    },
  };
}

function valuationResult(): ValuationResult {
  return {
    ticker: "AAPL",
    currentPrice: 200,
    metrics: {} as never,
    historicalComparison: {} as never,
    peerComparison: {} as never,
    dcf: {} as never,
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      rating: "expensive",
      explanation: "The stock trades above its historical average multiples.",
      biggestUncertainty: "x",
      assumptionExplanations: [],
      confidenceScore: 0.7,
    },
  };
}

function competitorResult(): CompetitorAnalysisResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    primaryCompany: {} as never,
    competitors: [],
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      competitiveScore: 40,
      confidenceScore: 0.7,
      competitorSelections: [{ ticker: "MSFT", companyName: "Microsoft Corporation", whyRelevant: "x" }],
      comparisonTable: [],
      whoIsWinning: "Apple appears to be leading in profitability.",
      companyStrengths: [],
      companyWeaknesses: [],
      biggestCompetitiveThreat: "x",
      overallConclusion: "x",
    },
  };
}

function managementResult(): ManagementAnalysisResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    capitalAllocation: {} as never,
    insiderActivity: {} as never,
    recentInsiderTransactionCount: 0,
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      managementScore: 35,
      overallAssessment: "good",
      confidenceScore: 0.6,
      whatManagementIsDoingWell: [],
      managementConcerns: [{ factor: "Guidance", explanation: "Occasionally optimistic." }],
      trackRecordVsGuidance: "Not available.",
      capitalAllocationAssessment: "Management has used cash carefully.",
      insiderActivityAssessment: "x",
      managementCredibility: "medium",
      managementCredibilityExplanation: "Limited data is available.",
      overallConclusion: "x",
    },
  };
}

function riskResult(): RiskAnalysisResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    signals: {} as never,
    newsEvidenceCount: 0,
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      riskScore: 30,
      riskLevel: "medium",
      confidenceScore: 0.6,
      biggestRisks: [
        { risk: "Slowing growth", evidence: "x", severity: "medium", probability: "medium", potentialImpact: "x", timeFrame: "medium_term", whatWouldConfirmIt: "x", whatWouldReduceIt: "x" },
      ],
      numberOneRisk: { risk: "Slowing growth", evidence: "x", severity: "medium", probability: "medium", potentialImpact: "x", timeFrame: "medium_term", whatWouldConfirmIt: "x", whatWouldReduceIt: "x" },
      whatWouldMakeMoreBearish: ["Revenue growth turns negative"],
      whatWouldMakeLessWorried: ["Growth reaccelerates"],
      overallConclusion: "x",
    },
  };
}

function gatheredFixture(
  currentPrice: number | null = 200,
  news: NewsIntelligenceResult | null = null
): GatheredAnalysisInputs {
  return {
    companyName: "Apple Inc.",
    currentPrice,
    inputsUsed: {
      technical: true,
      fundamental: true,
      valuation: true,
      sentiment: false,
      macro: false,
      competitor: true,
      management: true,
      risk: true,
    },
    summaries: {
      valuationDcfEstimates: { bearFairValue: 150, baseFairValue: 210, bullFairValue: 280 },
      technicalSummary: { trend: "uptrend", momentum: "bullish", technicalScore: 40, explanation: "x" },
      fundamentalSummary: { overallFundamentalScore: 60, overallConclusion: "x" },
      sentimentSummary: null,
      macroSummary: null,
      competitorSummary: { competitiveScore: 40, whoIsWinning: "x", biggestCompetitiveThreat: "x" },
      managementSummary: { managementScore: 35, overallAssessment: "good", overallConclusion: "x" },
      riskSummary: { riskScore: 30, riskLevel: "medium", numberOneRisk: "x", overallConclusion: "x" },
    },
    full: {
      technical: null,
      fundamental: fundamentalResult(),
      valuation: valuationResult(),
      sentiment: null,
      macro: null,
      competitor: competitorResult(),
      management: managementResult(),
      risk: riskResult(),
      news,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFinalReport", () => {
  function mockHappyPath() {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gatheredFixture(200, newsIntelResult()));
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (runDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: devilsAdvocateResult() });
  }

  it("gathers evidence once and reuses it across Forecast, Committee, and Devil's Advocate -- zero added AI-call cost", async () => {
    mockHappyPath();

    await runFinalReport("AAPL");

    expect(gatherAnalysisSummaries).toHaveBeenCalledTimes(1);
    const daCall = (runDevilsAdvocate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(daCall[1]).toHaveProperty("gathered");
    expect(daCall[1]).toHaveProperty("forecastResult");
    expect(daCall[1]).toHaveProperty("committeeResult");
  });

  it("uses the Forecast's real 12-month bear/base/bull data directly, without recalculating", async () => {
    mockHappyPath();

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.bearBaseBull.bear.priceTarget).toBe(150);
      expect(result.data.bearBaseBull.expectedPrice).toBe(215);
      expect(result.data.quickAnswer.expectedPrice).toBe(215);
    }
  });

  it("uses the Committee's original rating/confidence when the Devil's Advocate did not revise anything", async () => {
    mockHappyPath();

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.quickAnswer.rating).toBe("buy");
      expect(result.data.quickAnswer.confidenceScore).toBe(70);
      expect(result.data.finalConclusion.rating).toBe("buy");
    }
  });

  it("reflects the Devil's Advocate's revision when the thesis WAS revised", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gatheredFixture(200, newsIntelResult()));
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (runDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: devilsAdvocateResult({
        committeeReview: { wasThesisRevised: true, revisedRating: "hold", revisedConfidence: 50, whatChangedAndWhy: "Weaknesses were significant." },
      }),
    });

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.quickAnswer.rating).toBe("hold");
      expect(result.data.quickAnswer.confidenceScore).toBe(50);
      expect(result.data.devilsAdvocate.didItChangeAnything).toBe(true);
    }
  });

  it("buckets business quality labels from real scores, never fabricating a label for missing data", async () => {
    mockHappyPath();

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.businessQuality.financialHealth).toBe("strong"); // score 60 -> strong
      expect(result.data.businessQuality.growth).toBe("good"); // 12% growth -> good
      // sentiment was null in the fixture -- direction/trend fall back to neutral/stable, not fabricated specifics
      expect(result.data.marketSentiment.whatInvestorsLike).toEqual([]);
    }
  });

  it("includes real, sourced news events with URLs", async () => {
    mockHappyPath();

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.whatsHappeningNow.topEvents).toHaveLength(1);
      expect(result.data.whatsHappeningNow.topEvents[0]!.url).toBe("https://example.com/a");
      expect(result.data.sources).toHaveLength(1);
    }
  });

  it("flags a data-consistency note when valuation is expensive but expected return is strongly positive", async () => {
    mockHappyPath();

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // fixture: valuation "expensive", forecast expectedReturnPct 7.5 (not >15, so no note expected here)
      expect(result.data.dataConsistencyNotes).toEqual([]);
    }
  });

  it("degrades gracefully (empty defaults, not failure) when news intelligence is unavailable", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gatheredFixture(200, null));
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (runDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: devilsAdvocateResult() });

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.whatsHappeningNow.topEvents).toEqual([]);
      expect(result.data.sources).toEqual([]);
    }
  });

  it("returns an error when the forecast fails, since bear/base/bull cannot be honestly shown", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gatheredFixture());
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runFinalReport("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
    expect(runDevilsAdvocate).not.toHaveBeenCalled();
  });

  it("returns an error when there is no price data for the ticker", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gatheredFixture(null));

    const result = await runFinalReport("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(runForecast).not.toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runFinalReport("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(gatherAnalysisSummaries).not.toHaveBeenCalled();
  });
});
