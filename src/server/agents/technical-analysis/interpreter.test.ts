import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalculatedTechnicalMetrics } from "./types";

const SAMPLE_METRICS: CalculatedTechnicalMetrics = {
  source: "calculated",
  ticker: "AAPL",
  period: "1Y",
  barsUsed: 252,
  asOf: "2026-08-20T00:00:00.000Z",
  sma20: 220,
  sma50: 215,
  sma100: 205,
  sma200: 195,
  ema20: 221,
  rsi14: 62,
  macd: { line: 3.2, signal: 2.1, histogram: 1.1 },
  bollingerBands: { upper: 230, middle: 220, lower: 210 },
  atr14: 4.5,
  volumeTrend: { latestVolume: 50_000_000, averageVolume20: 45_000_000, ratio: 1.11 },
  volatilityAnnualizedPct: 28.5,
  momentum: { rateOfChange10Pct: 3.8 },
  supportLevels: [210, 200],
  resistanceLevels: [230, 240],
  currentPrice: 225,
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

describe("interpretTechnicalMetrics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify({
          trend: "uptrend",
          momentum: "bullish",
          bullishSignals: ["Price above SMA20 and SMA50", "MACD histogram positive"],
          bearishSignals: [],
          technicalScore: 45,
          explanation: "Price is trending upward with positive MACD momentum.",
        })
      )
    );

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.trend).toBe("uptrend");
      expect(result.data.technicalScore).toBe(45);
      expect(result.data.model).toMatch(/^claude-/);
    }
  });

  it("strips markdown code fences before parsing", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    const payload = {
      trend: "sideways",
      momentum: "neutral",
      bullishSignals: [],
      bearishSignals: [],
      technicalScore: 0,
      explanation: "No clear directional bias.",
    };
    mockAnthropicResponse(200, anthropicTextResponse("```json\n" + JSON.stringify(payload) + "\n```"));

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.trend).toBe("sideways");
  });

  it("rejects a response with an invalid enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify({
          trend: "extremely_bullish", // not in the allowed enum
          momentum: "bullish",
          bullishSignals: [],
          bearishSignals: [],
          technicalScore: 50,
          explanation: "x",
        })
      )
    );

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a technicalScore outside -100..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(
      200,
      anthropicTextResponse(
        JSON.stringify({
          trend: "uptrend",
          momentum: "bullish",
          bullishSignals: [],
          bearishSignals: [],
          technicalScore: 250,
          explanation: "x",
        })
      )
    );

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Sure! Here's my analysis: things look good."));

    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps HTTP 401 to AI_AUTH_ERROR", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "bad-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(401, { error: "unauthorized" });
    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
  });

  it("maps HTTP 429 to AI_RATE_LIMITED", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    mockAnthropicResponse(429, {});
    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_RATE_LIMITED");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretTechnicalMetrics(SAMPLE_METRICS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the calculated metrics as the user message (never asks the model to compute them)", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretTechnicalMetrics } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          anthropicTextResponse(
            JSON.stringify({
              trend: "sideways",
              momentum: "neutral",
              bullishSignals: [],
              bearishSignals: [],
              technicalScore: 0,
              explanation: "x",
            })
          ),
      });
    }) as unknown as typeof fetch;

    await interpretTechnicalMetrics(SAMPLE_METRICS);

    expect(capturedBody).toBeDefined();
    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain('"rsi14":62');
    expect(parsedBody.system).toContain("interpret");
  });
});
