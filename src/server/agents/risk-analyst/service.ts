import { getQuote, getHistoricalPrices, getStockSnapshot } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { getMacroIndicators } from "@/server/macro";
import { runNewsIntelligence } from "@/server/agents/news-intelligence";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { RiskAnalysisResult } from "@/lib/risk-types";
import { computeRiskSignals } from "./signals";
import { interpretRisk } from "./interpreter";

const log = logger.child("agents:risk-analyst");

/**
 * The Risk Analyst.
 *
 * Integration, not duplication -- this is a synthesis agent by design.
 * Rather than re-running every other paid AI agent (Fundamental Analyst,
 * Valuation Engine, Competitor Analysis, Management Analysis) to gather
 * inputs -- which would be both very expensive and largely redundant --
 * this agent reuses:
 *   - real, FREE deterministic data from Step 1 (price/volatility),
 *     Step 5 (financial-statement trends), and Step 10 (macro
 *     indicators), computed by `computeRiskSignals`.
 *   - Step 7's News Intelligence output (one AI call), filtered down to
 *     its already-classified bearish/high-importance events -- the same
 *     efficient reuse pattern the Sentiment Analysis agent (Step 9) uses.
 *
 * This keeps the total cost at two AI calls (News's + this agent's own),
 * the same order of magnitude as Sentiment Analysis, while still giving
 * the Risk Analyst real, current, company-specific evidence to challenge
 * the investment case with.
 */
export async function runRiskAnalysis(rawTicker: string): Promise<Result<RiskAnalysisResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [quoteResult, historyResult, fundamentalsResult, macroResult, newsResult, snapshotResult] =
    await Promise.all([
      getQuote(ticker),
      getHistoricalPrices(ticker, "6M"),
      getFundamentals(ticker, "annual"),
      getMacroIndicators(),
      runNewsIntelligence(ticker),
      getStockSnapshot(ticker, "1M"),
    ]);

  if (!newsResult.ok) return newsResult;

  // Price, fundamentals, and macro data are supporting signals -- degrade
  // gracefully (nulls/empty) rather than failing outright if any one of
  // them is unavailable (e.g. an FMP plan limitation), since the Risk
  // Analyst can still say something meaningful from news alone.
  const quote = quoteResult.ok ? quoteResult.data : null;
  const bars = historyResult.ok ? historyResult.data : [];
  const periods = fundamentalsResult.ok ? fundamentalsResult.data.periods.map((p) => p.period) : [];
  const macroIndicators = macroResult.ok ? macroResult.data : [];
  const companyName = snapshotResult.ok ? snapshotResult.data.companyName : null;

  const signals = computeRiskSignals(bars, quote, periods, macroIndicators);

  const bearishNewsEvents = newsResult.data.interpretation.importantEvents.filter(
    (e) => e.classification === "bearish" || e.importance === "high" || e.importance === "very_high"
  );

  const interpretationResult = await interpretRisk({
    ticker,
    companyName,
    signals,
    bearishNewsEvents,
  });

  if (!interpretationResult.ok) {
    log.warn("risk signals gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      signals,
      newsEvidenceCount: bearishNewsEvents.length,
      interpretation: interpretationResult.data,
    },
  };
}
