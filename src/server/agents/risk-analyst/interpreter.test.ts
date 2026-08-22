import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskInterpreterInput } from "./interpreter";
import type { RiskFactorSignals } from "@/lib/risk-types";

const SAMPLE_SIGNALS: RiskFactorSignals = {
  source: "calculated",
  volatilityAnnualizedPct: 35,
  revenueGrowthTrend: "decreasing",
  revenueGrowthPct: -5,
  netMarginTrend: "decreasing",
  netMarginPct: 8,
  totalDebtTrend: "increasing",
  cashTrend: "flat",
  freeCashFlowTrend: "decreasing",
  debtToCashRatio: 3.2,
  simplePeRatio: 45,
  macroIndicatorSummary: [{ name: "treasury10Year", label: "10-Year Treasury Yield", value: 4.3, unit: "%" }],
};

const SAMPLE_INPUT: RiskInterpreterInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  signals: SAMPLE_SIGNALS,
  bearishNewsEvents: [],
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

const VALID_RISK = {
  risk: "Slowing revenue growth",
  evidence: "Revenue growth is trending downward based on the most recent two reported periods.",
  severity: "medium",
  probability: "medium",
  potentialImpact: "Could pressure future earnings if the trend continues.",
  timeFrame: "medium_term",
  whatWouldConfirmIt: "Another quarter of declining growth.",
  whatWouldReduceIt: "A return to positive revenue growth.",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    riskScore: 55,
    riskLevel: "medium",
    confidenceScore: 0.6,
    biggestRisks: [VALID_RISK, VALID_RISK, VALID_RISK],
    numberOneRisk: VALID_RISK,
    whatWouldMakeMoreBearish: ["Revenue growth turns negative"],
    whatWouldMakeLessWorried: ["Revenue growth reaccelerates"],
    overallConclusion: "There are moderate risks worth watching.",
    ...overrides,
  };
}

describe("interpretRisk", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretRisk } = await import("./interpreter");

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.biggestRisks).toHaveLength(3);
    }
  });

  it("requires at least 3 biggestRisks per spec", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ biggestRisks: [VALID_RISK, VALID_RISK] }))));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects more than 5 biggestRisks per spec", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    const sixRisks = Array(6).fill(VALID_RISK);
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ biggestRisks: sixRisks }))));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a riskScore outside 0..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ riskScore: -5 }))));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a risk item missing the probability field (severity and probability must both be present, separately)", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    const badRisk = { ...VALID_RISK };
    delete (badRisk as Record<string, unknown>).probability;
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ biggestRisks: [badRisk, VALID_RISK, VALID_RISK] }))));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("There are some risks worth noting."));

    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretRisk(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the real signals/news and instructs against fabrication and conflating severity with probability", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretRisk } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretRisk(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"debtToCashRatio":3.2');
    expect(parsedBody.system.toLowerCase()).toContain("never invent");
    expect(parsedBody.system.toLowerCase()).toContain("different dimensions");
  });
});
