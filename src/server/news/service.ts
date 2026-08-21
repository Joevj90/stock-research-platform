import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsArticle } from "@/lib/news-types";
import { newsProvider } from "./provider";
import { NEWS_CACHE_TTL_MS, isFresh } from "./cache";

const log = logger.child("news:service");

const FETCH_LIMIT = 40; // enough raw articles for the AI to dedupe/select from

/**
 * ⚠️ ARCHITECTURAL BOUNDARY ⚠️ (same pattern as market-data/service.ts and
 * fundamentals/service.ts)
 *
 * The ONLY file allowed to import `newsProvider` or touch the database
 * for news data. The News Intelligence agent (and anything built later)
 * must go through `getCompanyNews` here.
 */
export async function getCompanyNews(rawTicker: string): Promise<Result<NewsArticle[]>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  try {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker },
    });

    const cacheEntry = await prisma.newsCacheEntry.findUnique({ where: { stockId: stock.id } });

    if (cacheEntry && isFresh(cacheEntry.retrievedAt, NEWS_CACHE_TTL_MS)) {
      const rows = await prisma.newsItem.findMany({
        where: { stockId: stock.id },
        orderBy: { publishedAt: "desc" },
        take: FETCH_LIMIT,
      });
      if (rows.length > 0) {
        log.debug("news cache hit", { ticker });
        return { ok: true, data: rows.map((r: NewsItemRow) => rowToArticle(r, ticker)) };
      }
    }

    log.debug("news cache miss — calling provider", { ticker });
    const result = await newsProvider.getCompanyNews(ticker, FETCH_LIMIT);
    if (!result.ok) return result;

    const articles = result.data;

    await prisma.$transaction([
      ...articles.map((a) =>
        prisma.newsItem.upsert({
          where: { stockId_url: { stockId: stock.id, url: a.url } },
          update: {
            headline: a.headline,
            publishedAt: new Date(a.publishedAt),
            sourceName: a.source,
            sourceType: a.sourceType,
            summary: a.summary,
            provider: newsProvider.id,
            retrievedAt: new Date(),
          },
          create: {
            stockId: stock.id,
            headline: a.headline,
            url: a.url,
            publishedAt: new Date(a.publishedAt),
            sourceName: a.source,
            sourceType: a.sourceType,
            summary: a.summary,
            provider: newsProvider.id,
          },
        })
      ),
      prisma.newsCacheEntry.upsert({
        where: { stockId: stock.id },
        update: { provider: newsProvider.id, retrievedAt: new Date() },
        create: { stockId: stock.id, provider: newsProvider.id },
      }),
    ]);

    return { ok: true, data: articles };
  } catch (err) {
    log.error("getCompanyNews failed", { ticker, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to fetch news." } };
  }
}

interface NewsItemRow {
  headline: string;
  url: string;
  publishedAt: Date;
  sourceName: string;
  sourceType: string | null;
  summary: string | null;
  provider: string;
  retrievedAt: Date;
}

function rowToArticle(row: NewsItemRow, ticker: string): NewsArticle {
  return {
    headline: row.headline,
    url: row.url,
    source: row.sourceName,
    publishedAt: row.publishedAt.toISOString(),
    summary: row.summary,
    sourceType: row.sourceType,
    ticker,
    retrievedAt: row.retrievedAt.toISOString(),
    provider: row.provider,
  };
}
