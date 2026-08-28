import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevilsAdvocateInterpreterInput } from "./interpreter";

const SAMPLE_INPUT: DevilsAdvocateInterpreterInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  currentPrice: 220,
  valuationDcfEstimates: { bearFairValue: 150, baseFairValue: 210, bullFairValue: 280 },
  technicalSummary: { trend: "uptrend", momentum: "bullish", technicalScore: 40, explanation: "x" },
  fundamentalSummary: { overallFundamentalScore: 50, overallConclusion: "x" },
  sentimentSummary: { sentimentScore: 30, sentimentDirection: "bullish", sentimentTrend: "improving", overallConclusion: "x" },
  macroSummary: { macroScore: 10, overallMacroEnvironment: "neutral", overallConclusion: "x" },
  competitorSummary: { competitiveScore: 40, whoIsWinning: "x", biggestCompetitiveThreat: "x" },
  managementSummary: { managementScore: 30, overallAssessment: "good", overallConclusion: "x" },
  riskSummary: { riskScore: 45, riskLevel: "medium", numberOneRisk: "x", overallConclusion: "x" },
  committee: {
    finalRecommendation: "buy",
    finalConfidence: 70,
    voteTally: { source: "calculated", buy: 3, hold: 1, sell: 1, totalVotes: 5 },
    keyAgreements: ["Fundamentals are strong"],
    keyDisagreements: [{ topic: "Valuation", description: "x", sidesSummary: "y" }],
    recommendationRationale: "x",
  },
  forecastTwelveMonth: {
    horizon: "12_month",
    bear: { scenario: "bear", explanation: "x", estimatedFinancialOutcome: "x", priceTarget: 150, expectedReturnPct: -25, probabilityPct: 20, mainReasons: [], keyRisks: [] },
    base: { scenario: "base", explanation: "x", estimatedFinancialOutcome: "x", priceTarget: 210, expectedReturnPct: 5, probabilityPct: 50, mainReasons: [], keyRisks: [] },
    bull: { scenario: "bull", explanation: "x", estimatedFinancialOutcome: "x", priceTarget: 280, expectedReturnPct: 40, probabilityPct: 30, mainReasons: [], keyRisks: [] },
    expectedPrice: 215,
    expectedReturnPct: 7.5,
    confidenceScore: 65,
  },
};

function mockAnthropicResponse(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

function anthropicTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const VALID_WEAKNESS = {
  problem: "x",
  evidence: "y",
  whyItMatters: "z",
  severity: "medium",
  couldChangeConclusion: false,
  recommendedAdjustment: null,
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    overallChallengeScore: 35,
    challengeLevel: "moderate",
    majorWeaknesses: [VALID_WEAKNESS],
    overlookedRisks: ["Customer concentration wasn't deeply reviewed"],
    questionableAssumptions: ["Assumes margins hold steady"],
    contradictoryEvidence: [],
    alternativeInterpretations: [{ fact: "Revenue grew 25%", commonInterpretation: "Strong growth", alternativeInterpretation: "May be a one-time boost" }],
    confidenceConcerns: [{ concern: "Limited data", explanation: "Some analyses were unavailable" }],
    whatAssumptionWorriesMost: "The assumption that growth continues.",
    couldThisChangeTheRating: "possibly",
    whyChangeOrNot: "The weaknesses are real but not severe enough alone.",
    recommendedChanges: ["Lower confidence slightly"],
    finalConclusion: "The thesis has some real weaknesses but is not fundamentally undermined.",
    committeeReview: { wasThesisRevised: false, revisedRating: null, wasConfidenceRevised: false, revisedConfidence: null, whatChangedAndWhy: null },
    ...overrides,
  };
}

describe("interpretDevilsAdvocate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed critique response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.interpretation.source).toBe("ai");
      expect(result.data.committeeReview.wasThesisRevised).toBe(false);
      expect(result.data.committeeReview.wasConfidenceRevised).toBe(false);
    }
  });

  it("accepts a genuine thesis revision with all required fields populated", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify(
          validPayload({
            committeeReview: {
              wasThesisRevised: true,
              revisedRating: "hold",
              wasConfidenceRevised: true,
              revisedConfidence: 50,
              whatChangedAndWhy: "The weaknesses were severe enough to lower conviction.",
            },
          })
        )
      )
    );

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.committeeReview.wasThesisRevised).toBe(true);
      expect(result.data.committeeReview.revisedRating).toBe("hold");
    }
  });

  it("accepts a confidence-only revision that leaves the rating unchanged", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify(
          validPayload({
            committeeReview: {
              wasThesisRevised: false,
              revisedRating: null,
              wasConfidenceRevised: true,
              revisedConfidence: 55,
              whatChangedAndWhy: "The vote was nearly tied, so the original confidence looked overstated.",
            },
          })
        )
      )
    );

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.committeeReview.wasThesisRevised).toBe(false);
      expect(result.data.committeeReview.revisedRating).toBeNull();
      expect(result.data.committeeReview.wasConfidenceRevised).toBe(true);
      expect(result.data.committeeReview.revisedConfidence).toBe(55);
    }
  });

  it("rejects a response where wasThesisRevised is true but revisedRating is null (inconsistent)", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify(
          validPayload({
            committeeReview: { wasThesisRevised: true, revisedRating: null, wasConfidenceRevised: true, revisedConfidence: null, whatChangedAndWhy: null },
          })
        )
      )
    );

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a response where wasThesisRevised is false but a revised rating is provided anyway (inconsistent)", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify(
          validPayload({
            committeeReview: { wasThesisRevised: false, revisedRating: "sell", wasConfidenceRevised: true, revisedConfidence: 40, whatChangedAndWhy: "x" },
          })
        )
      )
    );

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid challengeLevel enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ challengeLevel: "extreme" }))));

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here is my challenge to the thesis..."));

    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretDevilsAdvocate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the real committee conclusion and forecast scenario, and instructs it must not be automatically bearish", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDevilsAdvocate } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretDevilsAdvocate(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"finalRecommendation":"buy"');
    expect(parsedBody.messages[0].content).toContain('"expectedPrice":215');
    expect(parsedBody.system).toContain("NOT to be automatically bearish");
    expect(parsedBody.system.toLowerCase()).toContain("never invent evidence");
  });
});
