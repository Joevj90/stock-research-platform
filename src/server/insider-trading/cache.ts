/**
 * Cache freshness logic for insider trading -- mirrors news/cache.ts.
 * Insider transactions are filed periodically, not continuously, so 12
 * hours is a reasonable balance between staying current and conserving
 * the FMP request budget.
 */
export const INSIDER_TRADING_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function isFresh(retrievedAt: Date, ttlMs: number = INSIDER_TRADING_CACHE_TTL_MS, now: Date = new Date()): boolean {
  return now.getTime() - retrievedAt.getTime() < ttlMs;
}
