/**
 * Cache freshness logic for news -- mirrors market-data/cache.ts and
 * fundamentals/cache.ts's isFresh() pure function.
 *
 * News moves faster than financial statements but doesn't need to be
 * refetched on every request -- 2 hours balances staying current against
 * the FMP request budget, especially since a single "Run Analysis" click
 * also triggers an AI call on top of the fetch.
 */
export const NEWS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function isFresh(retrievedAt: Date, ttlMs: number = NEWS_CACHE_TTL_MS, now: Date = new Date()): boolean {
  return now.getTime() - retrievedAt.getTime() < ttlMs;
}
