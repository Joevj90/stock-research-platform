import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { CalculatedFundamentalMetrics, MetricPoint } from "@/lib/fundamental-analyst-types";
import { computeFinancialRatios } from "@/server/fundamentals/ratios";

/**
 * Deterministic derived-metric calculations for the Fundamental Analyst.
 * Every function here is pure arithmetic over Step 5's real
 * FinancialPeriod[] -- no AI, no network, no fabricated numbers. A metric
 * that can't be computed (missing inputs, division by zero, or not enough
 * history for a growth rate) is `null`, never a guess -- that null is what
 * lets the AI layer say "Data unavailable" honestly instead of inventing
 * a plausible-looking figure.
 *
 * Margins are NOT recomputed here -- they're pulled from Step 5's
 * `computeFinancialRatios` (src/server/fundamentals/ratios.ts) so there is
 * exactly one implementation of margin math in the app, per the
 * instruction to integrate with the existing system rather than
 * duplicating it.
 */
export function calculateFundamentalMetrics(
  ticker: string,
  periods: FinancialPeriod[]
): CalculatedFundamentalMetrics {
  const periodType = periods[0]?.periodType ?? "annual";

  const revenue = periods.map((p) => p.revenue);
  const netIncome = periods.map((p) => p.netIncome);
  const eps = periods.map((p) => p.eps);
  const freeCashFlow = periods.map((p) => p.freeCashFlow);

  const ratiosPerPeriod = periods.map(computeFinancialRatios);

  return {
    source: "calculated",
    ticker,
    periodType,
    periodsAnalyzed: periods.length,
    fiscalYears: periods.map((p) => p.fiscalYear),

    revenueGrowthPct: growthSeries(revenue),
    earningsGrowthPct: growthSeries(netIncome),
    epsGrowthPct: growthSeries(eps),
    freeCashFlowGrowthPct: growthSeries(freeCashFlow),

    grossMarginPct: ratiosPerPeriod.map((r) => r.grossMarginPct),
    operatingMarginPct: ratiosPerPeriod.map((r) => r.operatingMarginPct),
    netMarginPct: ratiosPerPeriod.map((r) => r.netMarginPct),

    returnOnEquityPct: periods.map((p) => safeDivide(p.netIncome, p.shareholdersEquity, 100)),
    returnOnInvestedCapitalPct: periods.map((p) =>
      // Simplified ROIC proxy: net income over (debt + equity), since this
      // app's data layer doesn't separately report NOPAT or a tax rate.
      // Uses only real reported figures -- documented here as a
      // simplification, not treated as a precise textbook ROIC.
      safeDivide(p.netIncome, addOrNull(p.totalDebt, p.shareholdersEquity), 100)
    ),
    assetTurnover: periods.map((p) => safeDivide(p.revenue, p.totalAssets, 1)),

    debtToEquity: ratiosPerPeriod.map((r) => r.debtToEquity),
    debtToOperatingCashFlow: periods.map((p) => safeDivide(p.totalDebt, p.operatingCashFlow, 1)),

    earningsQualityRatio: periods.map((p) => safeDivide(p.operatingCashFlow, p.netIncome, 1)),
  };
}

/** Period-over-period percentage growth, aligned so growthSeries(x)[i]
 * describes the change from period i-1 to period i. The first element is
 * always null (nothing to compare the first period against). */
function growthSeries(values: MetricPoint[]): MetricPoint[] {
  return values.map((current, i) => {
    if (i === 0) return null;
    const prior = values[i - 1] ?? null;
    if (current === null || prior === null || prior === 0) return null;
    return ((current - prior) / Math.abs(prior)) * 100;
  });
}

function safeDivide(numerator: number | null, denominator: number | null, scale: number): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * scale;
}

function addOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}
