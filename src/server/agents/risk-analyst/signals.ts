import type { PriceBar, Quote } from "@/lib/types";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { MacroIndicator } from "@/lib/macro-types";
import type { RiskFactorSignals } from "@/lib/risk-types";
import type { TrendDirection } from "@/lib/management-types";
import { annualizedVolatility } from "@/lib/technical-indicators";

/**
 * Deterministic, real-data risk signals -- reuses the shared
 * `annualizedVolatility` function (same one the Technical Analysis Agent
 * uses, from `@/lib/technical-indicators.ts`) rather than reimplementing
 * volatility math, and applies the same trend-detection pattern already
 * used by the Management Analyst's capital-allocation signals. No AI, no
 * fabrication -- every field is null/"unavailable" when the underlying
 * real data isn't there.
 */
export function computeRiskSignals(
  bars: PriceBar[],
  quote: Quote | null,
  periods: FinancialPeriod[],
  macroIndicators: MacroIndicator[]
): RiskFactorSignals {
  const latest = periods[periods.length - 1] ?? null;
  const prior = periods[periods.length - 2] ?? null;

  const revenueGrowthPct = growthPct(latest?.revenue ?? null, prior?.revenue ?? null);
  const netMarginLatest = marginPct(latest);
  const netMarginPrior = marginPct(prior);

  const debtToCashRatio =
    latest?.totalDebt !== null &&
    latest?.totalDebt !== undefined &&
    latest?.cash !== null &&
    latest?.cash !== undefined &&
    latest.cash > 0
      ? latest.totalDebt / latest.cash
      : null;

  const simplePeRatio =
    quote !== null && latest?.eps !== null && latest?.eps !== undefined && latest.eps > 0
      ? quote.price / latest.eps
      : null;

  return {
    source: "calculated",
    volatilityAnnualizedPct: annualizedVolatility(bars, 20),
    revenueGrowthTrend: trendFromValues(latest?.revenue ?? null, prior?.revenue ?? null),
    revenueGrowthPct,
    netMarginTrend: trendFromValues(netMarginLatest, netMarginPrior),
    netMarginPct: netMarginLatest,
    totalDebtTrend: trendFromValues(latest?.totalDebt ?? null, prior?.totalDebt ?? null),
    cashTrend: trendFromValues(latest?.cash ?? null, prior?.cash ?? null),
    freeCashFlowTrend: trendFromValues(latest?.freeCashFlow ?? null, prior?.freeCashFlow ?? null),
    debtToCashRatio,
    simplePeRatio,
    macroIndicatorSummary: macroIndicators.map((i) => ({
      name: i.name,
      label: i.label,
      value: i.value,
      unit: i.unit,
    })),
  };
}

function marginPct(period: FinancialPeriod | null): number | null {
  if (!period || period.revenue === null || period.revenue <= 0 || period.netIncome === null) return null;
  return (period.netIncome / period.revenue) * 100;
}

function growthPct(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function trendFromValues(latest: number | null, prior: number | null): TrendDirection {
  if (latest === null || prior === null || prior === 0) return "unavailable";
  const changePct = ((latest - prior) / Math.abs(prior)) * 100;
  if (Math.abs(changePct) < 1) return "flat";
  return changePct > 0 ? "increasing" : "decreasing";
}
