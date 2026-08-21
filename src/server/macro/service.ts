import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { MacroIndicator } from "@/lib/macro-types";
import { macroDataProvider } from "./provider";

const log = logger.child("macro:service");

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * ⚠️ ARCHITECTURAL BOUNDARY ⚠️ -- same pattern as every other data
 * service in this app: the only file allowed to import
 * `macroDataProvider` directly.
 *
 * Caching here is deliberately in-memory (a module-level variable), NOT
 * a database table. Every other data service in this app caches per
 * stock because the data is stock-specific; economic indicators are
 * identical for every company, so persisting them per-ticker in the DB
 * would be both wasteful and architecturally wrong. A single process-wide
 * cache is the correct shape for genuinely global data like this. This
 * does mean the cache resets on a server restart/redeploy -- acceptable
 * for a 12-hour TTL on data that only changes monthly at most.
 */
let cache: { indicators: MacroIndicator[]; provider: string; cachedAt: number } | null = null;

export async function getMacroIndicators(): Promise<Result<MacroIndicator[]>> {
  if (cache && cache.provider === macroDataProvider.id && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    log.debug("macro indicators cache hit");
    return { ok: true, data: cache.indicators };
  }

  log.debug("macro indicators cache miss — calling provider");
  const result = await macroDataProvider.getIndicators();
  if (!result.ok) return result;

  cache = { indicators: result.data, provider: macroDataProvider.id, cachedAt: Date.now() };
  return { ok: true, data: result.data };
}

/** Exposed only for tests, so the module-level cache doesn't leak state
 * between test cases. */
export function __resetMacroCacheForTests(): void {
  cache = null;
}
