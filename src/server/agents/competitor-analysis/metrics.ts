import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";
import type { CompanyMetricSet } from "@/lib/competitor-types";

/**
 * Deterministic, real-data metrics for one company -- pure arithmetic
 * over Step 1's quote and Step 5's financial-statement data. Used for
 * both the primary company and every competitor, so all comparisons in
 * this agent are apples-to-apples, computed the same way. No AI, no
 * fabrication -- a metric that can't be computed from real data is null.
 */
export function computeCompanyMetricSet(
  ticker: string,
  companyName: string | null,
  quote: Quote | null,
  periods: FinancialPeriod[]
): CompanyMetricSet {
  const latest = periods[periods.length - 1] ?? null;
  const prior = periods[periods.length - 2] ?? null;

  const revenueGrowthPct = growthPct(latest?.revenue ?? null, prior?.revenue ?? null);
  const earningsGrowthPct = growthPct(latest?.netIncome ?? null, prior?.netIncome ?? null);
  const freeCashFlowGrowthPct = growthPct(latest?.freeCashFlow ?? null, prior?.freeCashFlow ?? null);

  const netMarginPct =
    latest?.revenue && latest.revenue > 0 && latest.netIncome !== null
      ? (latest.netIncome / latest.revenue) * 100
      : null;

  const returnOnEquityPct =
    latest?.shareholdersEquity && latest.shareholdersEquity > 0 && latest.netIncome !== null
      ? (latest.netIncome / latest.shareholdersEquity) * 100
      : null;

  const peRatio =
    quote !== null && latest?.eps !== null && latest?.eps !== undefined && latest.eps > 0
      ? quote.price / latest.eps
      : null;

  return {
    source: "calculated",
    ticker,
    companyName,
    marketCap: quote?.marketCap ?? null,
    revenue: latest?.revenue ?? null,
    revenueGrowthPct,
    netIncome: latest?.netIncome ?? null,
    earningsGrowthPct,
    netMarginPct,
    freeCashFlow: latest?.freeCashFlow ?? null,
    freeCashFlowGrowthPct,
    totalDebt: latest?.totalDebt ?? null,
    cash: latest?.cash ?? null,
    returnOnEquityPct,
    peRatio,
  };
}

function growthPct(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
