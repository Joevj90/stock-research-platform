import type { FinancialPeriod, FinancialRatios } from "@/lib/fundamentals-types";

/**
 * Deterministic, comparable ratios computed from a single period's
 * figures. Pure arithmetic -- this is what "normalize financial data so
 * different companies can eventually be compared" means at this layer:
 * two companies reporting revenue in different absolute sizes still
 * produce directly comparable percentages here. Never AI-derived; a null
 * input always produces a null ratio rather than a guessed one.
 */
export function computeFinancialRatios(period: FinancialPeriod): FinancialRatios {
  return {
    grossMarginPct: safeDivide(period.grossProfit, period.revenue, 100),
    operatingMarginPct: safeDivide(period.operatingIncome, period.revenue, 100),
    netMarginPct: safeDivide(period.netIncome, period.revenue, 100),
    debtToEquity: safeDivide(period.totalDebt, period.shareholdersEquity, 1),
  };
}

function safeDivide(numerator: number | null, denominator: number | null, scale: number): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * scale;
}
