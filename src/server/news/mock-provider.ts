import type { NewsProvider } from "./provider.interface";
import type { NewsArticle } from "@/lib/news-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("news:mock");

const MOCK_HEADLINE_TEMPLATES = [
  { headline: "reports quarterly earnings, results in line with estimates", type: "earnings" },
  { headline: "announces new product update", type: "press_release" },
  { headline: "shares move after analyst note", type: "financial_news" },
  { headline: "discusses strategy at industry conference", type: "business_news" },
  { headline: "faces new competitive pressure in core market", type: "business_news" },
  { headline: "files routine regulatory disclosure", type: "regulatory" },
];

/**
 * MOCK news provider -- NOT real news. Generates deterministic,
 * clearly-labeled placeholder headlines with example.com URLs (never a
 * real-looking URL, so it can never be confused for an actual article)
 * so the News Intelligence agent is fully exercisable without a real API
 * key. Same convention as the other mock providers: isMock: true,
 * surfaced in the UI.
 */
export class MockNewsProvider implements NewsProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

  async getCompanyNews(ticker: string, limit: number): Promise<Result<NewsArticle[]>> {
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
      };
    }

    const now = new Date();
    const count = Math.min(limit, MOCK_HEADLINE_TEMPLATES.length);
    const articles: NewsArticle[] = Array.from({ length: count }, (_, i) => {
      const template = MOCK_HEADLINE_TEMPLATES[i % MOCK_HEADLINE_TEMPLATES.length]!;
      const publishedAt = new Date(now);
      publishedAt.setHours(publishedAt.getHours() - i * 8);

      return {
        headline: `${ticker.toUpperCase()} ${template.headline} (mock)`,
        url: `https://example.com/mock-news/${ticker.toLowerCase()}-${i}`,
        source: "Mock Wire (not a real source)",
        publishedAt: publishedAt.toISOString(),
        summary: "This is placeholder mock news content, not a real article.",
        sourceType: template.type,
        ticker: ticker.toUpperCase(),
        retrievedAt: new Date().toISOString(),
        provider: "mock",
      };
    });

    log.debug("generated mock news", { ticker, count: articles.length });
    return { ok: true, data: articles };
  }
}
