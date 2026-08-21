import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SentimentInterpreterInput } from "./interpreter";

const SAMPLE_INPUT: SentimentInterpreterInput = {
  whatsHappening: { positive: ["Strong earnings"], negative: [], neutral: [] },
  newsEvents: [
    {
      primaryArticleUrl: "https://example.com/a",
      relatedArticleUrls: [],
      whatHappened: "Company beat earnings estimates.",
      whyItMatters: "Shows the business is performing well.",
      possibleStockImpact: "This could support the stock.",
      timeHorizon: "short_term",
      timeHorizonExplanation: "days to weeks",
      importance: "high",
      classification: "bullish",
      recencyType: "recent_event",
    },
  ],
  marketReaction: { source: "calculated", recentPriceChangePct: 5, volumeVsAverage: 1.2 },
  fundamentalsSignal: { source: "calculated", latestRevenueGrowthPct: 15, latestNetIncomeGrowthPct: 20, simplePeRatio: 25 },
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

const VALID_ASSESSMENT = { whatIsHappening: "x", why: "y", whyItMatters: "z" };

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    sentimentScore: 45,
    sentimentDirection: "bullish",
    confidenceScore: 0.7,
    positiveFactors: ["Strong earnings beat"],
    negativeFactors: [],
    majorSentimentDrivers: ["Earnings beat"],
    sentimentTrend: "improving",
    sentimentTrendExplanation: "Recent news has been positive.",
    marketReaction: VALID_ASSESSMENT,
    sentimentVsFundamentals: VALID_ASSESSMENT,
    sentimentVsValuation: VALID_ASSESSMENT,
    overallConclusion: "Sentiment is positive and supported by real growth.",
    ...overrides,
  };
}

describe("interpretSentiment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretSentiment } = await import("./interpreter");

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.sentimentScore).toBe(45);
      expect(result.data.sentimentDirection).toBe("bullish");
    }
  });

  it("rejects a score outside -100..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ sentimentScore: 250 }))));

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid sentimentTrend enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ sentimentTrend: "skyrocketing" }))));

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a response missing a required assessment section", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    const payload = validPayload();
    delete (payload as Record<string, unknown>).sentimentVsValuation;
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(payload)));

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Investors seem pretty optimistic right now."));

    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    mockAnthropicResponse(401, {});
    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretSentiment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the already-classified news events and real signals, and instructs against social-media fabrication and simple counting", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretSentiment } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretSentiment(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"classification":"bullish"');
    expect(parsedBody.messages[0].content).toContain('"latestRevenueGrowthPct":15');
    expect(parsedBody.system.toLowerCase()).toContain("social media");
    expect(parsedBody.system.toLowerCase()).toContain("do not simply count");
  });
});
