import { getQuote, getPeerSymbols } from "@/server/market-data";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { PeerComparison, PeerMetricSet } from "@/lib/valuation-types";

const log = logger.child("agents:valuation-engine:peers");

/**
 * Compares the company's valuation against real peer companies -- NOT a
 * qualitative "Competitor Agent" (explicitly deferred to a later step).
 * This only reuses the market-data and fundamentals services already
 * built (never a provider directly) to pull each peer's current P/E,
 * Price/Sales, and EV/EBITDA, and averages them numerically. No AI
 * involvement, no competitive narrative -- just real numbers for real
 * peer tickers, the same way a human analyst would glance at a comps
 * table.
 */
export async function computePeerComparison(
  ticker: string,
  currentPeRatio: number | null,
  currentPriceToSales: number | null
): Promise<PeerComparison> {
  const peerSymbolsResult = await getPeerSymbols(ticker, 5);
  if (!peerSymbolsResult.ok) {
    log.warn("could not fetch peer symbols; returning empty peer comparison", {
      ticker,
      error: peerSymbolsResult.error,
    });
    return emptyComparison();
  }

  const peerSets = await Promise.all(
    peerSymbolsResult.data.map((peerTicker) => computeOnePeerMetricSet(peerTicker))
  );
  const peers = peerSets.filter((p): p is PeerMetricSet => p !== null);

  const averagePeRatio = average(peers.map((p) => p.peRatio));
  const averagePriceToSales = average(peers.map((p) => p.priceToSales));
  const averageEvToEbitda = average(peers.map((p) => p.evToEbitda));

  return {
    source: "calculated",
    peers,
    averagePeRatio,
    averagePriceToSales,
    averageEvToEbitda,
    currentPeVsPeerAveragePct: percentDiff(currentPeRatio, averagePeRatio),
    currentPsVsPeerAveragePct: percentDiff(currentPriceToSales, averagePriceToSales),
  };
}

async function computeOnePeerMetricSet(peerTicker: string): Promise<PeerMetricSet | null> {
  const [quoteResult, fundamentalsResult] = await Promise.all([
    getQuote(peerTicker),
    getFundamentals(peerTicker, "annual"),
  ]);

  if (!quoteResult.ok || !fundamentalsResult.ok) {
    log.debug("skipping peer with unavailable data", { peerTicker });
    return null;
  }

  const latestPeriod = fundamentalsResult.data.periods[fundamentalsResult.data.periods.length - 1]?.period;
  if (!latestPeriod) return null;

  const price = quoteResult.data.price;
  const marketCap = quoteResult.data.marketCap;

  const peRatio = latestPeriod.eps && latestPeriod.eps > 0 ? price / latestPeriod.eps : null;
  const priceToSales =
    marketCap !== null && latestPeriod.revenue !== null && latestPeriod.revenue > 0
      ? marketCap / latestPeriod.revenue
      : null;
  const netDebt =
    latestPeriod.totalDebt !== null && latestPeriod.cash !== null
      ? latestPeriod.totalDebt - latestPeriod.cash
      : null;
  const enterpriseValue = marketCap !== null && netDebt !== null ? marketCap + netDebt : null;
  const evToEbitda =
    enterpriseValue !== null && latestPeriod.ebitda !== null && latestPeriod.ebitda > 0
      ? enterpriseValue / latestPeriod.ebitda
      : null;

  return { ticker: peerTicker, peRatio, priceToSales, evToEbitda };
}

function emptyComparison(): PeerComparison {
  return {
    source: "calculated",
    peers: [],
    averagePeRatio: null,
    averagePriceToSales: null,
    averageEvToEbitda: null,
    currentPeVsPeerAveragePct: null,
    currentPsVsPeerAveragePct: null,
  };
}

function average(values: (number | null)[]): number | null {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return null;
  return nonNull.reduce((s, v) => s + v, 0) / nonNull.length;
}

function percentDiff(current: number | null, benchmark: number | null): number | null {
  if (current === null || benchmark === null || benchmark === 0) return null;
  return ((current - benchmark) / benchmark) * 100;
}
