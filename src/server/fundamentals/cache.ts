/**
 * Cache freshness logic for fundamentals -- mirrors
 * src/server/market-data/cache.ts's isFresh() pure function.
 *
 * Financial statements only change when a company files a new 10-K/10-Q
 * (quarterly at most), so the TTL is deliberately long compared to price
 * data's caches -- there's no reason to ever re-fetch more than once a
 * day, and 24h keeps the free-tier FMP request budget well within limits
 * even with regular use.
 */
export const FUNDAMENTALS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isFresh(retrievedAt: Date, ttlMs: number = FUNDAMENTALS_CACHE_TTL_MS, now: Date = new Date()): boolean {
  return now.getTime() - retrievedAt.getTime() < ttlMs;
}
