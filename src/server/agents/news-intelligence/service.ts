import { getCompanyNews } from "@/server/news";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import { interpretNews } from "./interpreter";

const log = logger.child("agents:news-intelligence");

/**
 * The News Intelligence Agent.
 *
 * Integration, not duplication: fetches real articles exclusively through
 * `getCompanyNews` from `@/server/news` -- the news module's own public
 * barrel. Never imports a news provider directly, never touches the
 * database. Everything this agent adds on top (grouping, classification,
 * plain-language explanation) comes from `interpretNews`, which is
 * structurally prevented from referencing an article that wasn't actually
 * fetched (see interpreter.ts's URL verification step).
 */
export async function runNewsIntelligence(rawTicker: string): Promise<Result<NewsIntelligenceResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const articlesResult = await getCompanyNews(ticker);
  if (!articlesResult.ok) return articlesResult;

  const articles = articlesResult.data;

  const interpretationResult = await interpretNews(ticker, articles);
  if (!interpretationResult.ok) {
    log.warn("news fetched but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      fetchedAt: new Date().toISOString(),
      articles,
      interpretation: interpretationResult.data,
    },
  };
}
