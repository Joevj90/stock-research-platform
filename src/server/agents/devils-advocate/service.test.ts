import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { DevilsAdvocateInterpreterOutput } from "./interpreter";

vi.mock("@/server/agents/shared/analysis-summaries", () => ({
  gatherAnalysisSummaries: vi.fn(),
}));
vi.mock("@/server/agents/forecasting", () => ({ runForecast: vi.fn() }));
vi.mock("@/server/agents/investment-committee", () => ({ runInvestmentCommittee: vi.fn() }));
vi.mock("./interpreter", () => ({ interpretDevilsAdvocate: vi.fn() }));

const { gatherAnalysisSummaries } = await import("@/server/agents/shared/analysis-summaries");
const { runForecast } = await import("@/server/agents/forecasting");
const { runInvestmentCommittee } = await import("@/server/agents/investment-committee");
const { interpretDevilsAdvocate } = await import("./interpreter");
const { runDevilsAdvocate } = await import("./service");

function gathered(currentPrice: number | null = 200): GatheredAnalysisInputs {
  return {
    companyName: "Apple Inc.",
    currentPrice,
    inputsUsed: {
      technical: true,
      fundamental: true,
      valuation: true,
      sentiment: false,
      macro: false,
      competitor: false,
      management: false,
      risk: false,
    },
    summaries: {
      valuationDcfEstimates: { bearFairValue: 150, baseFairValue: 210, bullFairValue: 280 },
      technicalSummary: { trend: "uptrend", momentum: "bullish", technicalScore: 40, explanation: "x" },
      fundamentalSummary: { overallFundamentalScore: 50, overallConclusion: "x" },
      sentimentSummary: null,
      macroSummary: null,
      competitorSummary: null,
      managementSummary: null,
      riskSummary: null,
    },
    full: {
      technical: null,
      fundamental: null,
      valuation: null,
      sentiment: null,
      macro: null,
      competitor: null,
      management: null,
      risk: null,
      news: null,
    },
  };
}

function committeeResult(): CommitteeResult {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    generatedAt: new Date().toISOString(),
    inputsUsed: gathered().inputsUsed,
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      personaEvaluations: [],
      voteTally: { source: "calculated", buy: 3, hold: 1, sell: 1, totalVotes: 5 },
      keyAgreements: [],
      keyDisagreements: [],
      debateExchanges: [],
      finalRecommendation: "buy",
      finalConfidence: 70,
      recommendationRationale: "x",
      minorityViewWorthConsidering: null,
      overallConclusion: "x",
    },
  };
}

function forecastResult(): ForecastResult {
  const scenario = {
    scenario: "base" as const,
    explanation: "x",
    estimatedFinancialOutcome: "x",
    priceTarget: 210,
    expectedReturnPct: 5,
    probabilityPct: 50,
    mainReasons: [],
    keyRisks: [],
  };
  const horizon = {
    horizon: "12_month" as const,
    dataSupportsThisHorizon: true,
    limitationNote: null,
    bear: { ...scenario, scenario: "bear" as const, priceTarget: 150, probabilityPct: 20 },
    base: scenario,
    bull: { ...scenario, scenario: "bull" as const, priceTarget: 280, probabilityPct: 30 },
    expectedPrice: 215,
    expectedReturnPct: 7.5,
    mostLikelyScenario: "base" as const,
  };
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    currentPrice: 200,
    generatedAt: new Date().toISOString(),
    inputsUsed: gathered().inputsUsed,
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

const SAMPLE_INTERPRETER_OUTPUT: DevilsAdvocateInterpreterOutput = {
  interpretation: {
    source: "ai",
    model: "claude-sonnet-5",
    generatedAt: new Date().toISOString(),
    overallChallengeScore: 30,
    challengeLevel: "moderate",
    majorWeaknesses: [],
    overlookedRisks: [],
    questionableAssumptions: [],
    contradictoryEvidence: [],
    alternativeInterpretations: [],
    confidenceConcerns: [],
    whatAssumptionWorriesMost: "x",
    couldThisChangeTheRating: "no",
    whyChangeOrNot: "x",
    recommendedChanges: [],
    finalConclusion: "x",
  },
  committeeReview: { wasThesisRevised: false, revisedRating: null, revisedConfidence: null, whatChangedAndWhy: null },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runDevilsAdvocate", () => {
  it("gathers evidence once and passes it to both runForecast and runInvestmentCommittee, avoiding redundant re-gathering", async () => {
    const g = gathered();
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(g);
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETER_OUTPUT });

    const result = await runDevilsAdvocate("AAPL");

    expect(gatherAnalysisSummaries).toHaveBeenCalledTimes(1);
    expect(runForecast).toHaveBeenCalledWith("AAPL", g);
    expect(runInvestmentCommittee).toHaveBeenCalledWith("AAPL", g);
    expect(result.ok).toBe(true);
  });

  it("extracts the 12-month horizon from the forecast to send to the interpreter", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETER_OUTPUT });

    await runDevilsAdvocate("AAPL");

    const call = (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.forecastTwelveMonth.horizon).toBe("12_month");
    expect(call.forecastTwelveMonth.expectedPrice).toBe(215);
    expect(call.committee.finalRecommendation).toBe("buy");
  });

  it("proceeds with a null forecastTwelveMonth if the forecast fails, since it still has a committee conclusion to challenge", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETER_OUTPUT });

    const result = await runDevilsAdvocate("AAPL");
    expect(result.ok).toBe(true);

    const call = (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.forecastTwelveMonth).toBeNull();
  });

  it("returns an error when there is no committee conclusion to challenge", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runDevilsAdvocate("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
    expect(interpretDevilsAdvocate).not.toHaveBeenCalled();
  });

  it("returns an error when no price data can be found for the ticker", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered(null));

    const result = await runDevilsAdvocate("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(runForecast).not.toHaveBeenCalled();
  });

  it("propagates an interpreter error", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (runForecast as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: forecastResult() });
    (runInvestmentCommittee as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: committeeResult() });
    (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_TIMEOUT", message: "timed out" },
    });

    const result = await runDevilsAdvocate("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_TIMEOUT");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runDevilsAdvocate("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(gatherAnalysisSummaries).not.toHaveBeenCalled();
  });

  it("uses precomputed gathered/forecast/committee results when provided, skipping all internal derivation", async () => {
    (interpretDevilsAdvocate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETER_OUTPUT });

    const g = gathered();
    const fr = { ok: true as const, data: forecastResult() };
    const cr = { ok: true as const, data: committeeResult() };

    const result = await runDevilsAdvocate("AAPL", { gathered: g, forecastResult: fr, committeeResult: cr });

    expect(gatherAnalysisSummaries).not.toHaveBeenCalled();
    expect(runForecast).not.toHaveBeenCalled();
    expect(runInvestmentCommittee).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.forecast).toEqual(fr.data);
      expect(result.data.committee).toEqual(cr.data);
      expect(result.data.gathered).toEqual(g);
    }
  });
});
