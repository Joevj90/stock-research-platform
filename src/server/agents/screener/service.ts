import { getQuote } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { ValuationGapCandidate, ValuationScanChunkResult } from "@/lib/screener-types";
import { runDcfScenario, deriveSharesOutstanding, buildScenarioAssumptions } from "@/server/agents/valuation-engine/dcf";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

const log = logger.child("agents:screener");

/**
 * Phase 1 of the Valuation Screener: for each ticker in this chunk,
 * fetch real price and financial-statement data (reusing the exact same
 * `getQuote`/`getFundamentals` service functions -- and their DB cache
 * -- every other part of this app uses) and compute the REAL DCF
 * base-case fair value with the Valuation Engine's own `dcf.ts`
 * functions, unmodified. No AI call is made anywhere in this function --
 * this is deliberately the cheap first pass, run across the full ~500
 * ticker S&P 500 universe in chunks, so that the expensive AI-backed
 * Forecasting Agent (Phase 2) only ever runs on a small shortlist.
 *
 * A ticker whose data can't support a DCF calculation (missing/negative
 * financials, no derivable share count) is skipped and reported in
 * `failedTickers` -- never given a fabricated fair value.
 */
export async function scanValuationGapChunk(tickers: string[]): Promise<ValuationScanChunkResult> {
  const results = await Promise.all(
    tickers.map(async (rawTicker): Promise<ValuationGapCandidate | { failed: string }> => {
      const ticker = rawTicker.trim().toUpperCase();
      if (!ticker) return { failed: rawTicker };

      try {
        const [quoteResult, fundamentalsResult] = await Promise.all([
          getQuote(ticker),
          getFundamentals(ticker, "annual"),
        ]);

        if (!quoteResult.ok || !fundamentalsResult.ok) return { failed: ticker };

        const periods = fundamentalsResult.data.periods.map((p) => p.period);
        const latestPeriod: FinancialPeriod | null = periods[periods.length - 1] ?? null;
        if (!latestPeriod) return { failed: ticker };

        const epsGrowthPct = computeLatestEpsGrowthPct(periods);
        const sharesOutstanding = deriveSharesOutstanding(latestPeriod);
        const { base } = buildScenarioAssumptions(latestPeriod, epsGrowthPct);
        const currentPrice = quoteResult.data.price;

        const baseScenario = runDcfScenario(latestPeriod, sharesOutstanding, base, "base", currentPrice);

        return {
          ticker,
          currentPrice,
          baseFairValue: baseScenario.fairValuePerShare,
          impliedUpsidePct: baseScenario.impliedUpsideDownsidePct,
        };
      } catch (err) {
        log.warn("valuation gap scan failed for ticker", { ticker, error: err instanceof Error ? err.message : String(err) });
        return { failed: ticker };
      }
    })
  );

  const candidates: ValuationGapCandidate[] = [];
  const failedTickers: string[] = [];
  for (const r of results) {
    if ("failed" in r) failedTickers.push(r.failed);
    else candidates.push(r);
  }

  return { candidates, failedTickers };
}

/** Same plain period-over-period EPS growth formula used in the
 * Valuation Engine (`valuation-engine/service.ts`) and duplicated here
 * for the same reason that module states for its own copy: the
 * Fundamental Analyst's growth math is that agent's own internal
 * implementation detail, not part of its public contract, so this small
 * calculation is kept local rather than reaching into another agent's
 * internals. */
function computeLatestEpsGrowthPct(periods: { eps: number | null }[]): number | null {
  if (periods.length < 2) return null;
  const current = periods[periods.length - 1]!.eps;
  const prior = periods[periods.length - 2]!.eps;
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
