import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValuationInterpreterInput } from "./interpreter";

const SAMPLE_INPUT: ValuationInterpreterInput = {
  metrics: {
    source: "calculated",
    ticker: "AAPL",
    asOfPrice: 200,
    asOfDate: "2026-08-20T00:00:00.000Z",
    peRatio: { value: 30, unavailableReason: null },
    forwardPeRatio: { value: null, unavailableReason: "not available" },
    pegRatio: { value: 1.5, unavailableReason: null },
    evToEbitda: { value: 20, unavailableReason: null },
    evToRevenue: { value: 8, unavailableReason: null },
    priceToSales: { value: 7, unavailableReason: null },
    priceToBook: { value: 15, unavailableReason: null },
    freeCashFlowYieldPct: { value: 3, unavailableReason: null },
    dividendYieldPct: { value: 0.5, unavailableReason: null },
  },
  historicalComparison: {
    source: "calculated",
    points: [],
    currentPeVsHistoricalAveragePct: 15,
    currentPsVsHistoricalAveragePct: 10,
  },
  peerComparison: {
    source: "calculated",
    peers: [],
    averagePeRatio: 25,
    averagePriceToSales: 6,
    averageEvToEbitda: 18,
    currentPeVsPeerAveragePct: 20,
    currentPsVsPeerAveragePct: 16,
  },
  dcf: {
    source: "calculated",
    bear: {
      name: "bear",
      assumptions: {
        initialRevenueGrowthPct: 4,
        terminalRevenueGrowthPct: 3,
        operatingMarginPct: 20,
        taxRatePct: 21,
        capexAsPctOfRevenue: 5,
        workingCapitalChangeAsPctOfRevenue: 1,
        discountRatePct: 10.5,
        terminalGrowthRatePct: 1.5,
        projectionYears: 5,
      },
      fairValuePerShare: 150,
      impliedUpsideDownsidePct: -25,
    },
    base: {
      name: "base",
      assumptions: {
        initialRevenueGrowthPct: 10,
        terminalRevenueGrowthPct: 3,
        operatingMarginPct: 24,
        taxRatePct: 21,
        capexAsPctOfRevenue: 5,
        workingCapitalChangeAsPctOfRevenue: 1,
        discountRatePct: 9,
        terminalGrowthRatePct: 2.5,
        projectionYears: 5,
      },
      fairValuePerShare: 210,
      impliedUpsideDownsidePct: 5,
    },
    bull: {
      name: "bull",
      assumptions: {
        initialRevenueGrowthPct: 16,
        terminalRevenueGrowthPct: 3,
        operatingMarginPct: 28,
        taxRatePct: 21,
        capexAsPctOfRevenue: 5,
        workingCapitalChangeAsPctOfRevenue: 1,
        discountRatePct: 8,
        terminalGrowthRatePct: 3,
        projectionYears: 5,
      },
      fairValuePerShare: 280,
      impliedUpsideDownsidePct: 40,
    },
    fairValueRangeLow: 150,
    fairValueRangeHigh: 280,
    sensitivity: [],
    sharesOutstandingUsed: 10_000_000_000,
    netDebtUsed: 20_000_000_000,
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

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    rating: "reasonably_priced",
    explanation: "The stock looks fairly priced given its growth.",
    biggestUncertainty: "Whether growth continues at the recent pace.",
    assumptionExplanations: [
      { key: "initialRevenueGrowthPct", label: "Revenue growth", explanation: "x" },
    ],
    confidenceScore: 0.75,
    ...overrides,
  };
}

describe("interpretValuation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretValuation } = await import("./interpreter");

    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.rating).toBe("reasonably_priced");
      expect(result.data.model).toMatch(/^claude-/);
    }
  });

  it("rejects an invalid rating enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ rating: "super_cheap" }))));

    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a confidenceScore outside 0..1", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ confidenceScore: 2 }))));

    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("The stock looks fairly priced overall."));

    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretValuation } = await import("./interpreter");

    mockAnthropicResponse(401, {});
    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretValuation(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the DCF scenarios and instructs no fabrication / no recomputation", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretValuation } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretValuation(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"fairValuePerShare":210');
    expect(parsedBody.system.toLowerCase()).toContain("never invent");
  });
});
