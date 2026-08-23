import { runNewsIntelligence } from "@/server/agents/news-intelligence";
import { getQuote, getHistoricalPrices } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import type { SentimentResult } from "@/lib/sentiment-types";
import { computeMarketReaction } from "./market-reaction";
import { computeFundamentalsSignal } from "./fundamentals-signal";
import { interpretSentiment } from "./interpreter";

const log = logger.child("agents:sentiment-analysis");

/**
 * The Sentiment Analysis Agent.
 *
 * Integration, not duplication -- this is the central design decision of
 * this step: rather than re-fetching raw news and re-implementing
 * deduplication/classification, this agent builds directly on Step 7's
 * already-classified, already-deduplicated `runNewsIntelligence` output.
 * That's what satisfies "duplicate stories do not distort the score" --
 * the dedup already happened one layer down, so there's nothing left
 * here that could double-count a story.
 *
 * Market-reaction and fundamentals signals are computed with the exact
 * same pure functions the Technical Analysis Agent and Fundamental
 * Analyst already use (see market-reaction.ts, fundamentals-signal.ts),
 * fetched via Step 1's and Step 5's public barrels -- free, deterministic
 * data, so comparing sentiment against reality doesn't require paying for
 * a second full agent run (Fundamental Analyst / Valuation Engine).
 *
 * This function never imports a provider, and never imports the news,
 * market-data, or fundamentals *providers* directly -- only their public
 * service/agent barrels.
 *
 * @param precomputedNews Optional -- if a caller (the shared
 * `gatherAnalysisSummaries`, since both this agent and Risk Analyst need
 * News independently) already has a fresh `runNewsIntelligence` result,
 * pass it here to skip a redundant News AI call. Backward compatible:
 * existing callers that omit this behave exactly as before.
 */
export async function runSentimentAnalysis(
  rawTicker: string,
  precomputedNews?: Result<NewsIntelligenceResult>
): Promise<Result<SentimentResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [newsResult, quoteResult, historyResult, fundamentalsResult] = await Promise.all([
    precomputedNews ?? runNewsIntelligence(ticker),
    getQuote(ticker),
    getHistoricalPrices(ticker, "1M"),
    getFundamentals(ticker, "annual"),
  ]);

  if (!newsResult.ok) return newsResult;

  // Market-data and fundamentals are supporting signals, not the core
  // input -- if either is unavailable (e.g. an FMP plan limitation),
  // degrade gracefully to nulls rather than failing the whole analysis,
  // since sentiment can still be meaningfully assessed from news alone.
  const quote = quoteResult.ok ? quoteResult.data : null;
  const bars = historyResult.ok ? historyResult.data : [];
  const periods = fundamentalsResult.ok ? fundamentalsResult.data.periods.map((p) => p.period) : [];

  const marketReaction = computeMarketReaction(bars);
  const fundamentalsSignal = computeFundamentalsSignal(periods, quote);

  const interpretationResult = await interpretSentiment({
    whatsHappening: newsResult.data.interpretation.whatsHappening,
    newsEvents: newsResult.data.interpretation.importantEvents,
    marketReaction,
    fundamentalsSignal,
  });

  if (!interpretationResult.ok) {
    log.warn("sentiment inputs gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      generatedAt: new Date().toISOString(),
      newsEventCount: newsResult.data.interpretation.importantEvents.length,
      marketReaction,
      fundamentalsSignal,
      interpretation: interpretationResult.data,
    },
  };
}
