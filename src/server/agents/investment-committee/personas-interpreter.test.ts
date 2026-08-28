import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonasInterpreterInput } from "./personas-interpreter";

const SAMPLE_INPUT: PersonasInterpreterInput = {
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

function persona(persona: string, recommendation = "buy") {
  return {
    persona,
    recommendation,
    confidence: 70,
    keyReasons: ["reason"],
    concernsOrCaveats: ["concern"],
    whatTheyWeighMost: "x",
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    personaEvaluations: [
      persona("value_investor", "hold"),
      persona("growth_investor", "buy"),
      persona("momentum_trader", "buy"),
      persona("risk_averse_investor", "sell"),
      persona("contrarian_investor", "hold"),
    ],
    ...overrides,
  };
}

describe("interpretPersonas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid response with exactly 5 distinct persona evaluations", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(5);
      const personas = result.data.map((p) => p.persona);
      expect(new Set(personas).size).toBe(5); // all distinct
    }
  });

  it("rejects a response with fewer than 5 personas", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(JSON.stringify(validPayload({ personaEvaluations: [persona("value_investor")] })))
    );

    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid recommendation enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    const bad = validPayload();
    (bad.personaEvaluations[0] as { recommendation: string }).recommendation = "strong_buy";
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(bad)));

    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here's what the analysts think..."));

    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretPersonas(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("instructs the model that personas must reason independently and may disagree", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretPersonas } = await import("./personas-interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretPersonas(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.system.toLowerCase()).toContain("may reach different conclusions");
    expect(parsedBody.messages[0].content).toContain("Apple Inc.");
    expect(parsedBody.system).toContain("CRITICAL JSON FORMATTING RULE");
  });
});
