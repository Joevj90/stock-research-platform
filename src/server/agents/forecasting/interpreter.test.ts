import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastInterpreterInput } from "./interpreter";

const SAMPLE_INPUT: ForecastInterpreterInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  currentPrice: 200,
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

const VALID_SCENARIO = {
  explanation: "x",
  estimatedFinancialOutcome: "y",
  priceTarget: 210,
  probabilityPct: 50,
  mainReasons: ["reason"],
  keyRisks: ["risk"],
};

function validHorizon(horizon: string) {
  return {
    horizon,
    dataSupportsThisHorizon: true,
    limitationNote: null,
    bear: { ...VALID_SCENARIO, priceTarget: 150, probabilityPct: 20 },
    base: { ...VALID_SCENARIO, priceTarget: 210, probabilityPct: 50 },
    bull: { ...VALID_SCENARIO, priceTarget: 280, probabilityPct: 30 },
    mostLikelyScenario: "base",
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    horizons: [validHorizon("3_month"), validHorizon("6_month"), validHorizon("12_month")],
    keyCatalysts: [{ whatCouldHappen: "x", whyItWouldHelp: "y", importance: "medium" }],
    keyRisksSummary: ["summary risk"],
    confidenceScore: 65,
    confidenceExplanation: "x",
    biggestOptimismReason: "x",
    biggestRiskReason: "y",
    assumptions: [{ assumption: "x", explanation: "y" }],
    overallConclusion: "Our most likely outcome is the Base Case.",
    ...overrides,
  };
}

describe("interpretForecast", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretForecast } = await import("./interpreter");

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed response with exactly 3 horizons", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.horizons).toHaveLength(3);
      expect(result.data.horizons.map((h) => h.horizon)).toEqual(["3_month", "6_month", "12_month"]);
    }
  });

  it("rejects a response with fewer than 3 horizons", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ horizons: [validHorizon("3_month")] }))));

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a confidenceScore outside 0..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ confidenceScore: 150 }))));

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a scenario with a non-positive priceTarget", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    const badHorizon = validHorizon("3_month");
    (badHorizon.bear as { priceTarget: number }).priceTarget = -10;
    mockAnthropicResponse(
      200,
      anthropicTextResponse(JSON.stringify(validPayload({ horizons: [badHorizon, validHorizon("6_month"), validHorizon("12_month")] })))
    );

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here's my forecast for this stock..."));

    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretForecast(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the real DCF anchors and other module summaries, and instructs against doing the arithmetic itself", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretForecast } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretForecast(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"baseFairValue":210');
    expect(parsedBody.system.toLowerCase()).toContain("do not perform the expected-price");
    expect(parsedBody.system.toLowerCase()).toContain("must not blindly trust");
  });
});
