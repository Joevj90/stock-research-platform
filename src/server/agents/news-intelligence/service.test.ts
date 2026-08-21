import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsArticle, NewsIntelligenceInterpretation } from "@/lib/news-types";

vi.mock("@/server/news", () => ({
  getCompanyNews: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretNews: vi.fn(),
}));

const { getCompanyNews } = await import("@/server/news");
const { interpretNews } = await import("./interpreter");
const { runNewsIntelligence } = await import("./service");

function article(): NewsArticle {
  return {
    headline: "Sample",
    url: "https://example.com/a",
    source: "Reuters",
    publishedAt: "2026-08-20T00:00:00.000Z",
    summary: "x",
    sourceType: null,
    ticker: "AAPL",
    retrievedAt: new Date().toISOString(),
    provider: "mock",
  };
}

const SAMPLE_INTERPRETATION: NewsIntelligenceInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  whatsHappening: { positive: [], negative: [], neutral: [] },
  importantEvents: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runNewsIntelligence", () => {
  it("fetches articles via the news service, never a provider directly", async () => {
    (getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [article()] });
    (interpretNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runNewsIntelligence("AAPL");

    expect(getCompanyNews).toHaveBeenCalledWith("AAPL");
    expect(result.ok).toBe(true);
  });

  it("returns articles and interpretation as separate objects", async () => {
    (getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [article()] });
    (interpretNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runNewsIntelligence("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.articles).toHaveLength(1);
      expect(result.data.interpretation.source).toBe("ai");
    }
  });

  it("propagates a news-service error without calling the interpreter", async () => {
    (getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runNewsIntelligence("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretNews).not.toHaveBeenCalled();
  });

  it("still calls the interpreter with an empty article list rather than short-circuiting", async () => {
    (getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (interpretNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runNewsIntelligence("AAPL");
    expect(interpretNews).toHaveBeenCalledWith("AAPL", []);
    expect(result.ok).toBe(true);
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [article()] });
    (interpretNews as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runNewsIntelligence("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching the news service", async () => {
    const result = await runNewsIntelligence("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getCompanyNews).not.toHaveBeenCalled();
  });
});
