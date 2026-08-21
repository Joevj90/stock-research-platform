import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";
import type { MetricValue, ValuationMetrics } from "@/lib/valuation-types";

/**
 * Deterministic valuation ratio calculations -- pure arithmetic over real
 * quote + financial-statement data already fetched by Steps 1 and 5. No
 * AI, no randomness. Every metric explicitly records WHY it's null when
 * it can't be meaningfully computed (negative/zero denominator, missing
 * input) rather than silently omitting it or computing a misleading
 * number -- "Do not calculate metrics when the underlying data is
 * unavailable or not meaningful."
 */
export function calculateValuationMetrics(
  ticker: string,
  quote: Quote,
  latestPeriod: FinancialPeriod | null,
  epsGrowthPct: number | null
): ValuationMetrics {
  const price = quote.price;
  const marketCap = quote.marketCap;

  if (!latestPeriod) {
    const unavailable: MetricValue = { value: null, unavailableReason: "No financial statement data available." };
    return {
      source: "calculated",
      ticker,
      asOfPrice: price,
      asOfDate: quote.asOf,
      peRatio: unavailable,
      forwardPeRatio: { value: null, unavailableReason: "Forward earnings estimates are not available in this app yet." },
      pegRatio: unavailable,
      evToEbitda: unavailable,
      evToRevenue: unavailable,
      priceToSales: unavailable,
      priceToBook: unavailable,
      freeCashFlowYieldPct: unavailable,
      dividendYieldPct: unavailable,
    };
  }

  const netDebt = subtractOrNull(latestPeriod.totalDebt, latestPeriod.cash);
  const enterpriseValue = marketCap !== null && netDebt !== null ? marketCap + netDebt : null;

  const peRatio = ratio(price, latestPeriod.eps, "the company's earnings per share are zero, negative, or unreported");
  const pegRatio = computePeg(peRatio, epsGrowthPct);
  const evToEbitda = ratio(
    enterpriseValue,
    latestPeriod.ebitda,
    "enterprise value or EBITDA is unavailable, zero, or negative"
  );
  const evToRevenue = ratio(enterpriseValue, latestPeriod.revenue, "enterprise value or revenue is unavailable");
  const priceToSales = ratioFromMarketCap(marketCap, latestPeriod.revenue, "revenue is unavailable or zero");
  const priceToBook = ratioFromMarketCap(
    marketCap,
    latestPeriod.shareholdersEquity,
    "shareholders' equity is unavailable, zero, or negative"
  );

  const fcfYield =
    marketCap !== null && marketCap > 0 && latestPeriod.freeCashFlow !== null
      ? { value: (latestPeriod.freeCashFlow / marketCap) * 100, unavailableReason: null }
      : { value: null, unavailableReason: "market cap or free cash flow is unavailable" };

  const dividendYield =
    marketCap !== null && marketCap > 0 && latestPeriod.dividendsPaid !== null
      ? { value: (Math.abs(latestPeriod.dividendsPaid) / marketCap) * 100, unavailableReason: null }
      : { value: null, unavailableReason: "market cap or dividend data is unavailable" };

  return {
    source: "calculated",
    ticker,
    asOfPrice: price,
    asOfDate: quote.asOf,
    peRatio,
    forwardPeRatio: {
      value: null,
      unavailableReason: "Forward earnings estimates are not available in this app yet.",
    },
    pegRatio,
    evToEbitda,
    evToRevenue,
    priceToSales,
    priceToBook,
    freeCashFlowYieldPct: fcfYield,
    dividendYieldPct: dividendYield,
  };
}

function ratio(numerator: number | null, denominator: number | null, unmetReason: string): MetricValue {
  if (numerator === null || denominator === null || denominator <= 0) {
    return { value: null, unavailableReason: `Not meaningful: ${unmetReason}.` };
  }
  return { value: numerator / denominator, unavailableReason: null };
}

function ratioFromMarketCap(marketCap: number | null, denominator: number | null, unmetReason: string): MetricValue {
  if (marketCap === null || denominator === null || denominator <= 0) {
    return { value: null, unavailableReason: `Not meaningful: ${unmetReason}.` };
  }
  return { value: marketCap / denominator, unavailableReason: null };
}

function computePeg(peRatio: MetricValue, epsGrowthPct: number | null): MetricValue {
  if (peRatio.value === null) {
    return { value: null, unavailableReason: "P/E is not meaningful, so PEG cannot be computed." };
  }
  if (epsGrowthPct === null || epsGrowthPct <= 0) {
    return {
      value: null,
      unavailableReason: "Not meaningful: earnings growth is unavailable, zero, or negative.",
    };
  }
  return { value: peRatio.value / epsGrowthPct, unavailableReason: null };
}

function subtractOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}
