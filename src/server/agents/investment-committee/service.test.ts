import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { PersonaEvaluation } from "@/lib/investment-committee-types";
import type { DebateResult } from "./debate-interpreter";

vi.mock("@/server/agents/shared/analysis-summaries", () => ({
  gatherAnalysisSummaries: vi.fn(),
}));

vi.mock("./personas-interpreter", () => ({
  interpretPersonas: vi.fn(),
}));

vi.mock("./debate-interpreter", () => ({
  interpretDebate: vi.fn(),
}));

const { gatherAnalysisSummaries } = await import("@/server/agents/shared/analysis-summaries");
const { interpretPersonas } = await import("./personas-interpreter");
const { interpretDebate } = await import("./debate-interpreter");
const { runInvestmentCommittee } = await import("./service");

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
  };
}

function personaEval(p: PersonaEvaluation["persona"], rec: PersonaEvaluation["recommendation"]): PersonaEvaluation {
  return { persona: p, recommendation: rec, confidence: 70, keyReasons: [], concernsOrCaveats: [], whatTheyWeighMost: "x" };
}

const FIVE_PERSONAS: PersonaEvaluation[] = [
  personaEval("value_investor", "hold"),
  personaEval("growth_investor", "buy"),
  personaEval("momentum_trader", "buy"),
  personaEval("risk_averse_investor", "sell"),
  personaEval("contrarian_investor", "hold"),
];

const SAMPLE_DEBATE_RESULT: DebateResult = {
  keyAgreements: [],
  keyDisagreements: [],
  debateExchanges: [],
  finalRecommendation: "hold",
  finalConfidence: 60,
  recommendationRationale: "x",
  minorityViewWorthConsidering: null,
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runInvestmentCommittee", () => {
  it("gathers evidence via the shared gatherer, runs personas then debate, and computes the vote tally deterministically", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (interpretPersonas as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: FIVE_PERSONAS });
    (interpretDebate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_DEBATE_RESULT });

    const result = await runInvestmentCommittee("AAPL");

    expect(gatherAnalysisSummaries).toHaveBeenCalledWith("AAPL");
    expect(interpretPersonas).toHaveBeenCalled();
    expect(interpretDebate).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.interpretation.voteTally).toEqual({
        source: "calculated",
        buy: 2,
        hold: 2,
        sell: 1,
        totalVotes: 5,
      });
    }
  });

  it("passes Phase 1's persona evaluations as fixed input to Phase 2", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (interpretPersonas as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: FIVE_PERSONAS });
    (interpretDebate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_DEBATE_RESULT });

    await runInvestmentCommittee("AAPL");

    const debateCall = (interpretDebate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(debateCall.personaEvaluations).toEqual(FIVE_PERSONAS);
  });

  it("returns an error when no price data can be found for the ticker", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered(null));

    const result = await runInvestmentCommittee("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretPersonas).not.toHaveBeenCalled();
  });

  it("propagates a Phase 1 (personas) error without calling Phase 2", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (interpretPersonas as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runInvestmentCommittee("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
    expect(interpretDebate).not.toHaveBeenCalled();
  });

  it("propagates a Phase 2 (debate) error", async () => {
    (gatherAnalysisSummaries as ReturnType<typeof vi.fn>).mockResolvedValue(gathered());
    (interpretPersonas as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: FIVE_PERSONAS });
    (interpretDebate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_TIMEOUT", message: "timed out" },
    });

    const result = await runInvestmentCommittee("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_TIMEOUT");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runInvestmentCommittee("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(gatherAnalysisSummaries).not.toHaveBeenCalled();
  });

  it("uses precomputedGathered when provided, skipping the internal re-gather entirely", async () => {
    (interpretPersonas as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: FIVE_PERSONAS });
    (interpretDebate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_DEBATE_RESULT });

    const result = await runInvestmentCommittee("AAPL", gathered());

    expect(gatherAnalysisSummaries).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});
