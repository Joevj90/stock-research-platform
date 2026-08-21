import type { FinancialPeriodType } from "@/lib/fundamentals-types";

/**
 * Fundamental Analyst domain types.
 *
 * This module maps directly onto the FACT / CALCULATION / AI
 * INTERPRETATION / CONCLUSION separation the analyst is required to
 * maintain:
 *   - FACT        = the raw reported figures already in Step 5's
 *                    FinancialPeriod[] (revenue, netIncome, etc.) -- this
 *                    module never re-states or duplicates them.
 *   - CALCULATION = CalculatedFundamentalMetrics below -- deterministic
 *                    derived numbers (growth rates, ROE, ROIC, ...),
 *                    zero AI involvement, tagged `source: "calculated"`.
 *   - AI INTERPRETATION = the *Assessment fields on
 *                    FundamentalAnalystResult -- Claude's qualitative
 *                    reading of the calculations, tagged `source: "ai"`.
 *   - CONCLUSION  = `overallConclusion` -- the AI's single synthesizing
 *                    statement, never presented as if it were a fact.
 */

/** A single derived metric value for one period. `null` means the
 * underlying figures needed to compute it weren't available -- this is
 * what lets the AI honestly say "Data unavailable" instead of guessing. */
export type MetricPoint = number | null;

export interface CalculatedFundamentalMetrics {
  source: "calculated";
  ticker: string;
  periodType: FinancialPeriodType;
  periodsAnalyzed: number; // how many periods of real data were available
  fiscalYears: number[]; // aligned with every array below, oldest first

  // --- Growth (period-over-period %, oldest pair first) ---
  revenueGrowthPct: MetricPoint[];
  earningsGrowthPct: MetricPoint[]; // net income growth
  epsGrowthPct: MetricPoint[];
  freeCashFlowGrowthPct: MetricPoint[];

  // --- Margins (%), reusing Step 5's ratio math per period ---
  grossMarginPct: MetricPoint[];
  operatingMarginPct: MetricPoint[];
  netMarginPct: MetricPoint[];

  // --- Returns & efficiency (%), per period ---
  returnOnEquityPct: MetricPoint[];
  returnOnInvestedCapitalPct: MetricPoint[];
  assetTurnover: MetricPoint[]; // revenue / total assets -- asset efficiency

  // --- Balance sheet strength, per period ---
  debtToEquity: MetricPoint[];
  debtToOperatingCashFlow: MetricPoint[]; // years of OCF to pay off debt

  // --- Earnings quality, per period ---
  // operating cash flow / net income -- near or above 1 suggests reported
  // profit is backed by real cash; well below 1 is a quality flag.
  earningsQualityRatio: MetricPoint[];
}

/** WHAT HAPPENED? / WHY IT MATTERS / IS IT GOOD OR BAD? -- the required
 * explanation shape, applied to every major conclusion. */
export interface Assessment {
  whatHappened: string;
  whyItMatters: string;
  isGoodOrBad: string;
}

export interface FundamentalAnalystInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  overallFundamentalScore: number; // -100..100
  confidenceScore: number; // 0..1 -- how much real data backed this analysis

  revenueAssessment: Assessment;
  earningsAssessment: Assessment;
  profitabilityAssessment: Assessment;
  cashFlowAssessment: Assessment;
  balanceSheetAssessment: Assessment;
  growthAssessment: Assessment;
  financialStrengthAssessment: Assessment;

  positiveFactors: string[];
  negativeFactors: string[];
  importantTrends: string[];
  keyConcerns: string[];

  /** The single synthesizing CONCLUSION -- never a stand-in for a fact. */
  overallConclusion: string;
}

export interface FundamentalAnalystResult {
  ticker: string;
  periodType: FinancialPeriodType;
  calculated: CalculatedFundamentalMetrics;
  interpretation: FundamentalAnalystInterpretation;
}
