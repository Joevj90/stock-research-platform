import { PERIOD_TO_DAYS, type HistoricalPeriod } from "@/lib/types";

/**
 * How long a cached fetch is considered fresh before the service will call
 * the provider again. Quotes move fast, so their TTL is short; daily
 * historical bars for a closed trading day never change, so their TTL is
 * long — the only reason to ever refresh them is to pick up today's new
 * bar or fix a bad earlier fetch.
 */
export const QUOTE_CACHE_TTL_MS = 60_000; // 1 minute
export const HISTORICAL_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Sentinel `period` value used for quote cache entries (see schema.prisma
 * for why this can't just be null). */
export const QUOTE_CACHE_PERIOD = "REALTIME";

/**
 * Pure function: is a cache entry retrieved at `retrievedAt` still fresh,
 * given `ttlMs` and the current time `now`? Pulled out as a pure function
 * (no DB, no Date.now() inside) specifically so it's trivial to unit test
 * every boundary case without touching Prisma.
 */
export function isFresh(retrievedAt: Date, ttlMs: number, now: Date = new Date()): boolean {
  return now.getTime() - retrievedAt.getTime() < ttlMs;
}

/** Computes the [from, to] calendar-date range for a given historical
 * period, anchored on `now`. Pulled out as a pure function for the same
 * testability reason as `isFresh`. */
export function periodToRange(
  period: HistoricalPeriod,
  now: Date = new Date()
): { from: Date; to: Date } {
  const days = PERIOD_TO_DAYS[period];
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from, to };
}
