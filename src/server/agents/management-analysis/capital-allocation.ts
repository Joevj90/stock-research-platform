import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { CapitalAllocationSignal, CapitalAllocationTrend } from "@/lib/management-types";

/**
 * Deterministic capital-allocation signals -- pure arithmetic over real
 * financial-statement history (Step 5's FinancialPeriod[]). No AI, no
 * fabrication. Every trend is "unavailable" (never a guess) when the
 * underlying two most recent periods don't both have the relevant field.
 */
export function computeCapitalAllocationSignal(periods: FinancialPeriod[]): CapitalAllocationSignal {
  const latest = periods[periods.length - 1] ?? null;
  const prior = periods[periods.length - 2] ?? null;

  return {
    source: "calculated",
    dividendsPaidTrend: buildTrend(
      absOrNull(latest?.dividendsPaid ?? null),
      absOrNull(prior?.dividendsPaid ?? null)
    ),
    totalDebtTrend: buildTrend(latest?.totalDebt ?? null, prior?.totalDebt ?? null),
    cashTrend: buildTrend(latest?.cash ?? null, prior?.cash ?? null),
    freeCashFlowTrend: buildTrend(latest?.freeCashFlow ?? null, prior?.freeCashFlow ?? null),
    impliedSharesOutstandingTrend: buildTrend(impliedShares(latest), impliedShares(prior)),
  };
}

function impliedShares(period: FinancialPeriod | null): number | null {
  if (!period || period.netIncome === null || period.eps === null || period.eps === 0) return null;
  const shares = period.netIncome / period.eps;
  return shares > 0 ? shares : null;
}

function absOrNull(value: number | null): number | null {
  return value === null ? null : Math.abs(value);
}

function buildTrend(latest: number | null, prior: number | null): CapitalAllocationTrend {
  if (latest === null || prior === null) {
    return { direction: "unavailable", latestValue: latest, priorValue: prior, changePct: null };
  }
  if (prior === 0) {
    return { direction: "unavailable", latestValue: latest, priorValue: prior, changePct: null };
  }

  const changePct = ((latest - prior) / Math.abs(prior)) * 100;
  const direction: CapitalAllocationTrend["direction"] =
    Math.abs(changePct) < 1 ? "flat" : changePct > 0 ? "increasing" : "decreasing";

  return { direction, latestValue: latest, priorValue: prior, changePct };
}
