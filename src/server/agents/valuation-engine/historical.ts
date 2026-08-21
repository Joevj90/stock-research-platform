import type { PriceBar } from "@/lib/types";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { HistoricalComparison, HistoricalComparisonPoint } from "@/lib/valuation-types";

/**
 * Compares today's valuation against the company's OWN historical
 * valuation -- computed entirely from real data this app already fetches
 * (Step 1's price history + Step 5's financial statement history). For
 * each past fiscal period, finds the closing price nearest that period's
 * reporting date and computes what P/E and Price/Sales would have been
 * at that point -- pure arithmetic, no AI, no external "historical P/E"
 * data source needed.
 */
export function computeHistoricalComparison(
  priceHistory: PriceBar[],
  periods: FinancialPeriod[],
  currentPeRatio: number | null,
  currentPriceToSales: number | null
): HistoricalComparison {
  const points: HistoricalComparisonPoint[] = periods.map((period) => {
    const priceNearPeriodEnd = findNearestPrice(priceHistory, period.reportingPeriodEnd);
    const peRatio =
      priceNearPeriodEnd !== null && period.eps !== null && period.eps > 0
        ? priceNearPeriodEnd / period.eps
        : null;
    const priceToSales =
      priceNearPeriodEnd !== null && period.revenue !== null && period.revenue > 0
        ? // Approximates market cap with price alone is wrong for P/S (needs
          // shares outstanding); instead derive an implied shares count from
          // net income / eps where possible so this stays a real ratio, not
          // a fabricated one.
          computeHistoricalPriceToSales(priceNearPeriodEnd, period)
        : null;

    return { fiscalYear: period.fiscalYear, peRatio, priceToSales };
  });

  const historicalPe = points.map((p) => p.peRatio).filter((v): v is number => v !== null);
  const historicalPs = points.map((p) => p.priceToSales).filter((v): v is number => v !== null);

  return {
    source: "calculated",
    points,
    currentPeVsHistoricalAveragePct: percentDiffFromAverage(currentPeRatio, historicalPe),
    currentPsVsHistoricalAveragePct: percentDiffFromAverage(currentPriceToSales, historicalPs),
  };
}

/** Historical P/S needs an implied share count; derived from that
 * period's own net income / eps (both real reported figures) rather than
 * assuming today's share count applied historically. Null if either is
 * missing or eps is zero. */
function computeHistoricalPriceToSales(price: number, period: FinancialPeriod): number | null {
  if (period.netIncome === null || period.eps === null || period.eps === 0 || period.revenue === null) {
    return null;
  }
  const impliedShares = period.netIncome / period.eps;
  if (impliedShares <= 0) return null;
  const impliedMarketCap = price * impliedShares;
  return impliedMarketCap / period.revenue;
}

function findNearestPrice(bars: PriceBar[], targetDateIso: string): number | null {
  if (bars.length === 0) return null;
  const target = new Date(targetDateIso).getTime();

  let closest: PriceBar | null = null;
  let closestDiff = Infinity;
  for (const bar of bars) {
    const diff = Math.abs(new Date(bar.timestamp).getTime() - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = bar;
    }
  }
  return closest ? closest.close : null;
}

function percentDiffFromAverage(current: number | null, historical: number[]): number | null {
  if (current === null || historical.length === 0) return null;
  const average = historical.reduce((s, v) => s + v, 0) / historical.length;
  if (average === 0) return null;
  return ((current - average) / average) * 100;
}
