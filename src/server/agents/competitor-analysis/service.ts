import { getStockSnapshot, getPeerSymbols } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CompanyMetricSet, CompetitorAnalysisResult } from "@/lib/competitor-types";
import { computeCompanyMetricSet } from "./metrics";
import { interpretCompetitors } from "./interpreter";

const log = logger.child("agents:competitor-analysis");

const MAX_CANDIDATES = 5;

/**
 * The Competitor Analysis Agent.
 *
 * Integration, not duplication: competitor identification reuses
 * `getPeerSymbols` (Step 8's real FMP peers lookup) rather than building
 * a second peer-discovery mechanism. Every company's metrics (primary
 * company and each candidate) are computed by the exact same
 * `computeCompanyMetricSet` function over real quote (Step 1) and
 * financial-statement (Step 5) data -- fetched via those modules' own
 * public barrels, never a provider directly, and never triggering the
 * separate, paid-AI Fundamental Analyst or Valuation Engine agents for
 * each competitor (that would be both expensive and unnecessary --
 * this agent only needs the real numbers, not another AI's opinion of
 * them).
 */
export async function runCompetitorAnalysis(rawTicker: string): Promise<Result<CompetitorAnalysisResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [primarySnapshotResult, peerSymbolsResult] = await Promise.all([
    getStockSnapshot(ticker, "1M"),
    getPeerSymbols(ticker, MAX_CANDIDATES),
  ]);

  if (!primarySnapshotResult.ok) return primarySnapshotResult;

  const companyName = primarySnapshotResult.data.companyName;
  const primaryFundamentalsResult = await getFundamentals(ticker, "annual");
  const primaryPeriods = primaryFundamentalsResult.ok
    ? primaryFundamentalsResult.data.periods.map((p) => p.period)
    : [];

  const primaryCompany = computeCompanyMetricSet(
    ticker,
    companyName,
    primarySnapshotResult.data.quote,
    primaryPeriods
  );

  const candidateTickers = peerSymbolsResult.ok ? peerSymbolsResult.data : [];
  const candidates = (
    await Promise.all(candidateTickers.map((peerTicker) => computeOneCandidate(peerTicker)))
  ).filter((c): c is CompanyMetricSet => c !== null);

  if (!peerSymbolsResult.ok) {
    log.warn("could not identify competitors; proceeding with primary company only", {
      ticker,
      error: peerSymbolsResult.error,
    });
  }

  const interpretationResult = await interpretCompetitors({ primaryCompany, candidates });
  if (!interpretationResult.ok) {
    log.warn("competitor metrics gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      primaryCompany,
      competitors: candidates,
      interpretation: interpretationResult.data,
    },
  };
}

async function computeOneCandidate(peerTicker: string): Promise<CompanyMetricSet | null> {
  const [snapshotResult, fundamentalsResult] = await Promise.all([
    getStockSnapshot(peerTicker, "1M"),
    getFundamentals(peerTicker, "annual"),
  ]);

  if (!snapshotResult.ok) {
    log.debug("skipping candidate competitor with unavailable quote/profile data", { peerTicker });
    return null;
  }

  const periods = fundamentalsResult.ok ? fundamentalsResult.data.periods.map((p) => p.period) : [];
  return computeCompanyMetricSet(peerTicker, snapshotResult.data.companyName, snapshotResult.data.quote, periods);
}
