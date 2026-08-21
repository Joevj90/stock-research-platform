import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalculatedFundamentalMetrics } from "@/lib/fundamental-analyst-types";

const SAMPLE_METRICS: CalculatedFundamentalMetrics = {
  source: "calculated",
  ticker: "AAPL",
  periodType: "annual",
  periodsAnalyzed: 3,
  fiscalYears: [2023, 2024, 2025],
  revenueGrowthPct: [null, 20, 25],
  earningsGrowthPct: [null, 25, 20],
  epsGrowthPct: [null, 20, 25],
  freeCashFlowGrowthPct: [null, 20, 50],
  grossMarginPct: [40, 41, 42],
  operatingMarginPct: [20, 21, 22],
  netMarginPct: [10, 11, 12],
  returnOnEquityPct: [15, 16, 18],
  returnOnInvestedCapitalPct: [12, 13, 14],
  assetTurnover: [0.5, 0.5, 0.6],
  debtToEquity: [0.5, 0.6, 0.7],
  debtToOperatingCashFlow: [1, 1.2, 1.5],
  earningsQualityRatio: [1.1, 1.15, 1.2],
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

const VALID_ASSESSMENT = { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" };

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    overallFundamentalScore: 55,
    confidenceScore: 0.8,
    revenueAssessment: VALID_ASSESSMENT,
    earningsAssessment: VALID_ASSESSMENT,
    profitabilityAssessment: VALID_ASSESSMENT,
    cashFlowAssessment: VALID_ASSESSMENT,
    balanceSheetAssessment: VALID_ASSESSMENT,
    growthAssessment: VALID_ASSESSMENT,
    financialStrengthAssessment: VALID_ASSESSMENT,
    positiveFactors: ["Revenue grew 25%"],
    negativeFactors: [],
    importantTrends: ["Margins expanding steadily"],
    keyConcerns: [],
    overallConclusion: "The company looks financially healthy overall.",
    ...overrides,
  };
}

describe("interpretFundamentalMetrics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.overallFundamentalScore).toBe(55);
      expect(result.data.revenueAssessment.whatHappened).toBe("x");
      expect(result.data.model).toMatch(/^claude-/);
    }
  });

  it("strips markdown code fences before parsing", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("```json\n" + JSON.stringify(validPayload()) + "\n```"));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(true);
  });

  it("rejects a score outside -100..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ overallFundamentalScore: 250 }))));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a confidenceScore outside 0..1", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ confidenceScore: 5 }))));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a response missing a required assessment", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    const payload = validPayload();
    delete (payload as Record<string, unknown>).balanceSheetAssessment;
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(payload)));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an assessment missing one of its three required parts", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    const payload = validPayload({ revenueAssessment: { whatHappened: "x", whyItMatters: "y" } });
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(payload)));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here's my analysis of the company's financials..."));

    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(401, {});
    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps HTTP 429 to AI_RATE_LIMITED", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    mockAnthropicResponse(429, {});
    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_RATE_LIMITED");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretFundamentalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the calculated metrics (including nulls) as the user message, and instructs no fabrication", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretFundamentalMetrics } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => anthropicTextResponse(JSON.stringify(validPayload())),
      });
    }) as unknown as typeof fetch;

    await interpretFundamentalMetrics(SAMPLE_METRICS);

    expect(capturedBody).toBeDefined();
    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"revenueGrowthPct":[null,20,25]');
    expect(parsedBody.system.toLowerCase()).toContain("never invent");
    expect(parsedBody.system).toContain("Data unavailable");
  });
});
