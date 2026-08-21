import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsArticle } from "@/lib/news-types";

const REAL_ARTICLES: NewsArticle[] = [
  {
    headline: "Company reports strong quarter",
    url: "https://example.com/real-article-1",
    source: "Reuters",
    publishedAt: "2026-08-20T00:00:00.000Z",
    summary: "Earnings beat expectations.",
    sourceType: null,
    ticker: "AAPL",
    retrievedAt: new Date().toISOString(),
    provider: "mock",
  },
  {
    headline: "Company faces new lawsuit",
    url: "https://example.com/real-article-2",
    source: "Bloomberg",
    publishedAt: "2026-08-19T00:00:00.000Z",
    summary: "A lawsuit was filed.",
    sourceType: null,
    ticker: "AAPL",
    retrievedAt: new Date().toISOString(),
    provider: "mock",
  },
];

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

const VALID_EVENT = {
  primaryArticleUrl: "https://example.com/real-article-1",
  relatedArticleUrls: [],
  whatHappened: "The company reported strong results.",
  whyItMatters: "This shows the business is performing well.",
  possibleStockImpact: "This could support the stock price.",
  timeHorizon: "short_term",
  timeHorizonExplanation: "This effect would likely show up within days to weeks.",
  importance: "high",
  classification: "bullish",
  recencyType: "recent_event",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    whatsHappening: { positive: ["Strong earnings"], negative: [], neutral: [] },
    importantEvents: [VALID_EVENT],
    ...overrides,
  };
}

describe("interpretNews", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretNews } = await import("./interpreter");

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid response referencing a real article URL", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.importantEvents).toHaveLength(1);
      expect(result.data.importantEvents[0]!.primaryArticleUrl).toBe("https://example.com/real-article-1");
    }
  });

  it("DROPS an event whose primaryArticleUrl doesn't match a real fetched article (anti-hallucination guardrail)", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    const fabricatedEvent = { ...VALID_EVENT, primaryArticleUrl: "https://fake-news-site.com/invented-article" };
    mockAnthropicResponse(
      200,
      anthropicTextResponse(JSON.stringify(validPayload({ importantEvents: [fabricatedEvent, VALID_EVENT] })))
    );

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the real, verifiable event survives -- the fabricated one is silently dropped.
      expect(result.data.importantEvents).toHaveLength(1);
      expect(result.data.importantEvents[0]!.primaryArticleUrl).toBe("https://example.com/real-article-1");
    }
  });

  it("filters out relatedArticleUrls that don't match a real fetched article, keeping the event", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    const eventWithFakeRelated = {
      ...VALID_EVENT,
      relatedArticleUrls: ["https://example.com/real-article-2", "https://fake.com/invented"],
    };
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ importantEvents: [eventWithFakeRelated] }))));

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.importantEvents[0]!.relatedArticleUrls).toEqual(["https://example.com/real-article-2"]);
    }
  });

  it("returns an empty importantEvents array without error when nothing is important", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(JSON.stringify({ whatsHappening: { positive: [], negative: [], neutral: [] }, importantEvents: [] }))
    );

    const result = await interpretNews("AAPL", []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.importantEvents).toEqual([]);
  });

  it("rejects a response with an invalid classification enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    const badEvent = { ...VALID_EVENT, classification: "super_bullish" };
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ importantEvents: [badEvent] }))));

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Here's what I found in the news..."));

    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretNews } = await import("./interpreter");

    mockAnthropicResponse(401, {});
    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretNews("AAPL", REAL_ARTICLES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends only real article fields to the model and instructs no fabrication", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretNews } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => anthropicTextResponse(JSON.stringify(validPayload())),
      });
    }) as unknown as typeof fetch;

    await interpretNews("AAPL", REAL_ARTICLES);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain("real-article-1");
    expect(parsedBody.system.toLowerCase()).toContain("never invent");
  });
});
