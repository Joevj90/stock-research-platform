import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComparisonInterpreterInput } from "./comparison-interpreter";
import type { SavedAnalysisRecord } from "@/lib/analysis-history-types";

function analysis(overrides: Partial<SavedAnalysisRecord> = {}): SavedAnalysisRecord {
  return {
    id: "a1",
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    analysisDate: "2026-01-01T00:00:00.000Z",
    priceAtAnalysis: 150,
    rating: "buy",
    confidenceScore: 78,
    bearPrice: 130,
    basePrice: 180,
    bullPrice: 220,
    expectedPrice: 180,
    expectedReturnPct: 20,
    bearProbabilityPct: 20,
    baseProbabilityPct: 50,
    bullProbabilityPct: 30,
    valuationConclusion: "x",
    sentimentConclusion: "x",
    macroConclusion: "x",
    competitorConclusion: "x",
    managementConclusion: "x",
    committeeConclusion: "x",
    devilsAdvocateConclusion: "x",
    bottomLine: "x",
    majorAssumptions: [],
    majorRisks: [],
    majorCatalysts: [],
    keyNewsFindings: [],
    ...overrides,
  };
}

const SAMPLE_INPUT: ComparisonInterpreterInput = {
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  previous: analysis(),
  current: analysis({ id: "a2", priceAtAnalysis: 165, confidenceScore: 71, analysisDate: "2026-03-01T00:00:00.000Z" }),
  deltas: {
    priceChangePct: 10,
    expectedPriceChangePct: 8.3,
    confidenceChangePts: -7,
    expectedReturnChangePts: -5,
    ratingChanged: false,
    daysBetweenAnalyses: 59,
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

const VALID_CHANGE_ITEM = { whatChanged: "x", whyItMatters: "y", direction: "improved" };

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    whatChanged: [VALID_CHANGE_ITEM, VALID_CHANGE_ITEM, VALID_CHANGE_ITEM],
    thesisChangeLevel: "slightly_changed",
    thesisChangeExplanation: "x",
    ratingChangeExplanation: "The rating did not change because the evidence is largely the same.",
    priceRelatedChanges: ["The stock got more expensive relative to earnings."],
    businessRelatedChanges: ["Revenue growth accelerated."],
    whatImproved: ["Revenue growth"],
    whatGotWorse: ["Valuation"],
    whatStayedTheSame: ["Competitive position"],
    whyOpinionChanged: "x",
    finalBottomLine: "The stock looks roughly as attractive as before.",
    ...overrides,
  };
}

describe("interpretComparison", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed comparison response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.whatChanged).toHaveLength(3);
      expect(result.data.thesisChangeLevel).toBe("slightly_changed");
    }
  });

  it("requires at least 3 whatChanged items", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ whatChanged: [VALID_CHANGE_ITEM] }))));

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects more than 7 whatChanged items", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    const eightItems = Array(8).fill(VALID_CHANGE_ITEM);
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ whatChanged: eightItems }))));

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid thesisChangeLevel enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ thesisChangeLevel: "totally_different" }))));

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here's what changed..."));

    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretComparison(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the real previous/current analyses and deltas, and instructs against attributing rating changes to price alone", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretComparison } = await import("./comparison-interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretComparison(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"priceChangePct":10');
    expect(parsedBody.system.toLowerCase()).toContain("do not change the rating assessment simply because the stock price changed");
    expect(parsedBody.system.toLowerCase()).toContain("separate what changed because of the stock price");
  });
});
