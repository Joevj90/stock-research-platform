import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebateInterpreterInput } from "./debate-interpreter";
import type { PersonaEvaluation } from "@/lib/investment-committee-types";

function persona(p: PersonaEvaluation["persona"], recommendation: PersonaEvaluation["recommendation"]): PersonaEvaluation {
  return { persona: p, recommendation, confidence: 70, keyReasons: [], concernsOrCaveats: [], whatTheyWeighMost: "x" };
}

const SAMPLE_INPUT: DebateInterpreterInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  personaEvaluations: [
    persona("value_investor", "hold"),
    persona("growth_investor", "buy"),
    persona("momentum_trader", "buy"),
    persona("risk_averse_investor", "sell"),
    persona("contrarian_investor", "hold"),
  ],
  valuationDcfEstimates: { bearFairValue: 150, baseFairValue: 210, bullFairValue: 280 },
  technicalSummary: { trend: "uptrend", momentum: "bullish", technicalScore: 40, explanation: "x" },
  fundamentalSummary: { overallFundamentalScore: 50, overallConclusion: "x" },
  sentimentSummary: { sentimentScore: 30, sentimentDirection: "bullish", sentimentTrend: "improving", overallConclusion: "x" },
  macroSummary: { macroScore: 10, overallMacroEnvironment: "neutral", overallConclusion: "x" },
  competitorSummary: { competitiveScore: 40, whoIsWinning: "x", biggestCompetitiveThreat: "x" },
  managementSummary: { managementScore: 30, overallAssessment: "good", overallConclusion: "x" },
  riskSummary: { riskScore: 45, riskLevel: "medium", numberOneRisk: "x", overallConclusion: "x" },
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

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    keyAgreements: ["Fundamentals look solid"],
    keyDisagreements: [{ topic: "Valuation", description: "x", sidesSummary: "y" }],
    debateExchanges: [
      { personaA: "risk_averse_investor", personaB: "growth_investor", challenge: "x", response: "y" },
    ],
    finalRecommendation: "hold",
    finalConfidence: 60,
    recommendationRationale: "A genuine synthesis, not a vote count.",
    minorityViewWorthConsidering: "The risk-averse investor remains cautious about debt levels.",
    overallConclusion: "The committee leans cautiously positive overall.",
    ...overrides,
  };
}

describe("interpretDebate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretDebate } = await import("./debate-interpreter");

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed debate/consensus response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finalRecommendation).toBe("hold");
      expect(result.data.minorityViewWorthConsidering).toBeTruthy();
    }
  });

  it("accepts a null minorityViewWorthConsidering", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ minorityViewWorthConsidering: null }))));

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.minorityViewWorthConsidering).toBeNull();
  });

  it("rejects an invalid finalRecommendation enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ finalRecommendation: "strong_buy" }))));

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a debate exchange referencing an invalid persona key", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    const bad = validPayload({
      debateExchanges: [{ personaA: "skeptic", personaB: "growth_investor", challenge: "x", response: "y" }],
    });
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(bad)));

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("The committee generally agrees..."));

    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretDebate(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends Phase 1's fixed persona evaluations and instructs against a simple vote-count recommendation", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretDebate } = await import("./debate-interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretDebate(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"persona":"risk_averse_investor"');
    expect(parsedBody.system.toLowerCase()).toContain("not be a simple majority vote");
  });
});
