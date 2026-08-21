import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { Quote } from "@/lib/types";
import type { FundamentalsSignal } from "@/lib/sentiment-types";

/**
 * Lightweight, deterministic real-data signals used only so the AI can
 * compare sentiment against actual company performance and a rough
 * valuation reference point -- WITHOUT triggering the separate,
 * paid-AI-call Fundamental Analyst or Valuation Engine agents. All
 * inputs are real (Step 5's fundamentals, Step 1's quote); nothing here
 * is estimated. This intentionally does not duplicate those agents' full
 * ratio/DCF math -- it's just enough real signal for a sentiment-vs-
 * reality comparison, kept local to this agent per the same pattern the
 * Fundamental Analyst uses for its own growth calculations.
 */
export function computeFundamentalsSignal(periods: FinancialPeriod[], quote: Quote | null): FundamentalsSignal {
  const latest = periods[periods.length - 1];
  const prior = periods[periods.length - 2];

  const latestRevenueGrowthPct = growthPct(latest?.revenue ?? null, prior?.revenue ?? null);
  const latestNetIncomeGrowthPct = growthPct(latest?.netIncome ?? null, prior?.netIncome ?? null);

  const simplePeRatio =
    quote !== null && latest?.eps !== null && latest?.eps !== undefined && latest.eps > 0
      ? quote.price / latest.eps
      : null;

  return {
    source: "calculated",
    latestRevenueGrowthPct,
    latestNetIncomeGrowthPct,
    simplePeRatio,
  };
}

function growthPct(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
