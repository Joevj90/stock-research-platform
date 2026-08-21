import { getQuote, getHistoricalPrices } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { ValuationResult } from "@/lib/valuation-types";
import { calculateValuationMetrics } from "./metrics";
import { computeHistoricalComparison } from "./historical";
import { computePeerComparison } from "./peers";
import { runDcfScenario, deriveSharesOutstanding, buildSensitivity, buildScenarioAssumptions } from "./dcf";
import { interpretValuation } from "./interpreter";

const log = logger.child("agents:valuation-engine");

/**
 * The Valuation Engine.
 *
 * Integration, not duplication: fetches price and financial data
 * exclusively through the market-data and fundamentals modules' own
 * public barrels (`@/server/market-data`, `@/server/fundamentals`) --
 * never a provider directly, never the database directly. Every ratio,
 * historical comparison, peer comparison, and DCF number is computed by
 * this module's pure calculation functions (metrics.ts, historical.ts,
 * peers.ts, dcf.ts) before the AI ever sees anything -- the AI
 * (interpreter.ts) only rates and explains numbers that already exist.
 */
export async function runValuationAnalysis(rawTicker: string): Promise<Result<ValuationResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [quoteResult, historyResult, fundamentalsResult] = await Promise.all([
    getQuote(ticker),
    getHistoricalPrices(ticker, "5Y"),
    getFundamentals(ticker, "annual"),
  ]);

  if (!quoteResult.ok) return quoteResult;
  if (!historyResult.ok) return historyResult;
  if (!fundamentalsResult.ok) return fundamentalsResult;

  const periods = fundamentalsResult.data.periods.map((p) => p.period);
  const latestPeriod = periods[periods.length - 1] ?? null;

  if (!latestPeriod) {
    return {
      ok: false,
      error: { code: "INSUFFICIENT_DATA", message: `No financial statement data available for ${ticker}.` },
    };
  }

  // Reuse Step 6's growth-rate math shape (simple period-over-period %)
  // for EPS growth, needed for PEG -- computed locally here rather than
  // reaching into the Fundamental Analyst agent's internals, since that
  // module's public barrel intentionally exposes only its own run
  // function, not its calculation internals.
  const epsGrowthPct = computeLatestEpsGrowthPct(periods);

  const metrics = calculateValuationMetrics(ticker, quoteResult.data, latestPeriod, epsGrowthPct);

  const historicalComparison = computeHistoricalComparison(
    historyResult.data,
    periods,
    metrics.peRatio.value,
    metrics.priceToSales.value
  );

  const peerComparison = await computePeerComparison(ticker, metrics.peRatio.value, metrics.priceToSales.value);

  const sharesOutstanding = deriveSharesOutstanding(latestPeriod);
  const { bear, base, bull } = buildScenarioAssumptions(latestPeriod, epsGrowthPct);
  const currentPrice = quoteResult.data.price;

  const bearScenario = runDcfScenario(latestPeriod, sharesOutstanding, bear, "bear", currentPrice);
  const baseScenario = runDcfScenario(latestPeriod, sharesOutstanding, base, "base", currentPrice);
  const bullScenario = runDcfScenario(latestPeriod, sharesOutstanding, bull, "bull", currentPrice);
  const sensitivity = buildSensitivity(latestPeriod, sharesOutstanding, base);

  const fairValues = [bearScenario.fairValuePerShare, baseScenario.fairValuePerShare, bullScenario.fairValuePerShare]
    .filter((v): v is number => v !== null);

  const dcf = {
    source: "calculated" as const,
    bear: bearScenario,
    base: baseScenario,
    bull: bullScenario,
    fairValueRangeLow: fairValues.length > 0 ? Math.min(...fairValues) : null,
    fairValueRangeHigh: fairValues.length > 0 ? Math.max(...fairValues) : null,
    sensitivity,
    sharesOutstandingUsed: sharesOutstanding,
    netDebtUsed:
      latestPeriod.totalDebt !== null && latestPeriod.cash !== null
        ? latestPeriod.totalDebt - latestPeriod.cash
        : null,
  };

  const interpretationResult = await interpretValuation({ metrics, historicalComparison, peerComparison, dcf });
  if (!interpretationResult.ok) {
    log.warn("valuation calculated but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      currentPrice,
      metrics,
      historicalComparison,
      peerComparison,
      dcf,
      interpretation: interpretationResult.data,
    },
  };
}

/** Simple period-over-period EPS growth (most recent two periods), the
 * same plain formula used elsewhere in the app -- kept local since the
 * Fundamental Analyst's growth math is an internal implementation detail
 * of that agent, not part of its public contract. */
function computeLatestEpsGrowthPct(periods: { eps: number | null }[]): number | null {
  if (periods.length < 2) return null;
  const current = periods[periods.length - 1]!.eps;
  const prior = periods[periods.length - 2]!.eps;
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
