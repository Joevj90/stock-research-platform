import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsArticle } from "@/lib/news-types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    newsItem: { findMany: vi.fn(), upsert: vi.fn() },
    newsCacheEntry: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("./provider", () => ({
  newsProvider: {
    id: "mock",
    isMock: true,
    getCompanyNews: vi.fn(),
  },
}));

const { prisma } = await import("@/server/db/client");
const { newsProvider } = await import("./provider");
const { getCompanyNews } = await import("./service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    headline: "Sample headline",
    url: "https://example.com/article-1",
    source: "Reuters",
    publishedAt: "2026-08-20T00:00:00.000Z",
    summary: "A summary.",
    sourceType: null,
    ticker: "AAPL",
    retrievedAt: new Date().toISOString(),
    provider: "mock",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("getCompanyNews", () => {
  it("calls the provider on a cache miss and persists via a transaction", async () => {
    (prisma.newsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (newsProvider.getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [article(), article({ url: "https://example.com/article-2" })],
    });

    const result = await getCompanyNews("AAPL");

    expect(newsProvider.getCompanyNews).toHaveBeenCalledWith("AAPL", 40);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(2);
  });

  it("serves from the DB on a fresh cache hit, without calling the provider", async () => {
    (prisma.newsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
      provider: "mock",
    });
    (prisma.newsItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        headline: "Cached headline",
        url: "https://example.com/cached",
        publishedAt: new Date(),
        sourceName: "Reuters",
        sourceType: null,
        summary: "x",
        provider: "mock",
        retrievedAt: new Date(),
      },
    ]);

    const result = await getCompanyNews("AAPL");

    expect(newsProvider.getCompanyNews).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.ticker).toBe("AAPL");
    }
  });

  it("falls back to the provider if the cache entry is fresh but the DB has no articles", async () => {
    (prisma.newsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
    });
    (prisma.newsItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (newsProvider.getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [article()],
    });

    const result = await getCompanyNews("AAPL");
    expect(newsProvider.getCompanyNews).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("propagates a provider error without writing to the DB", async () => {
    (prisma.newsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (newsProvider.getCompanyNews as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await getCompanyNews("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching the provider or DB", async () => {
    const result = await getCompanyNews("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(newsProvider.getCompanyNews).not.toHaveBeenCalled();
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });
});
