import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorInterpreterInput } from "./interpreter";
import type { CompanyMetricSet } from "@/lib/competitor-types";

function metricSet(ticker: string, overrides: Partial<CompanyMetricSet> = {}): CompanyMetricSet {
  return {
    source: "calculated",
    ticker,
    companyName: `${ticker} Inc.`,
    marketCap: 1_000_000_000_000,
    revenue: 100_000_000_000,
    revenueGrowthPct: 10,
    netIncome: 20_000_000_000,
    earningsGrowthPct: 15,
    netMarginPct: 20,
    freeCashFlow: 18_000_000_000,
    freeCashFlowGrowthPct: 12,
    totalDebt: 30_000_000_000,
    cash: 40_000_000_000,
    returnOnEquityPct: 25,
    peRatio: 28,
    ...overrides,
  };
}

const SAMPLE_INPUT: CompetitorInterpreterInput = {
  primaryCompany: metricSet("AAPL"),
  candidates: [metricSet("MSFT"), metricSet("GOOGL")],
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

const VALID_ROW = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  growth: "average",
  profitability: "leading",
  financialStrength: "leading",
  valuation: "average",
  competitivePosition: "leading",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    competitiveScore: 45,
    confidenceScore: 0.7,
    competitorSelections: [{ ticker: "MSFT", companyName: "Microsoft", whyRelevant: "Competes in cloud and devices." }],
    comparisonTable: [VALID_ROW],
    whoIsWinning: "Apple appears to be leading on profitability.",
    companyStrengths: [{ factor: "Brand", explanation: "Strong customer loyalty." }],
    companyWeaknesses: [{ factor: "Growth", explanation: "Slower revenue growth than some peers." }],
    biggestCompetitiveThreat: "Increasing competition in services.",
    overallConclusion: "Apple holds a strong competitive position overall.",
    ...overrides,
  };
}

describe("interpretCompetitors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretCompetitors } = await import("./interpreter");

    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.competitiveScore).toBe(45);
      expect(result.data.comparisonTable).toHaveLength(1);
    }
  });

  it("rejects an invalid ComparisonLevel enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    const badRow = { ...VALID_ROW, growth: "dominant" };
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ comparisonTable: [badRow] }))));

    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a competitiveScore outside -100..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ competitiveScore: 500 }))));

    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Apple looks strong versus its competitors."));

    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    mockAnthropicResponse(401, {});
    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretCompetitors(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the real metric sets and instructs against market-share fabrication", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretCompetitors } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretCompetitors(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"ticker":"MSFT"');
    expect(parsedBody.messages[0].content).toContain('"revenueGrowthPct":10');
    expect(parsedBody.system.toLowerCase()).toContain("no real market-share data");
  });
});
