/**
 * Competitor Analysis domain types.
 *
 * FACT / CALCULATION / AI INTERPRETATION / CONCLUSION, mapped:
 *   - FACT           = the real quote and financial-statement figures
 *                       (Steps 1 & 5) each CompanyMetricSet is built from.
 *   - CALCULATION    = CompanyMetricSet below -- deterministic derived
 *                       numbers (growth rates, margins, ROE, simple P/E),
 *                       zero AI, tagged `source: "calculated"`. A null
 *                       value always means the underlying data wasn't
 *                       available -- never a guess.
 *   - AI INTERPRETATION = CompetitorAnalysisInterpretation below --
 *                       which peers are genuinely relevant and why, the
 *                       comparison table's qualitative labels, the
 *                       competitive score, strengths/weaknesses, the
 *                       biggest threat -- tagged `source: "ai"`.
 *   - CONCLUSION     = `overallConclusion` -- never presented as if it
 *                       were a verified fact, especially anything framed
 *                       as "gaining/losing market share", which is an
 *                       inference from growth-rate comparisons, not a
 *                       real market-share statistic (this app has none).
 */

export type ComparisonLevel = "leading" | "average" | "lagging" | "unavailable";

/** Deterministic, real-data metrics for one company (the primary company
 * or a competitor) -- pure arithmetic over Step 1 (quote) and Step 5
 * (financial statements) data. Every field is null (never guessed) when
 * the underlying real data isn't available. */
export interface CompanyMetricSet {
  source: "calculated";
  ticker: string;
  companyName: string | null;
  marketCap: number | null;
  revenue: number | null;
  revenueGrowthPct: number | null;
  netIncome: number | null;
  earningsGrowthPct: number | null;
  netMarginPct: number | null;
  freeCashFlow: number | null;
  freeCashFlowGrowthPct: number | null;
  totalDebt: number | null;
  cash: number | null;
  returnOnEquityPct: number | null;
  peRatio: number | null;
}

/** Why a specific competitor was selected -- qualitative reasoning about
 * business similarity (products, customers, business model), not a
 * fabricated statistic. */
export interface CompetitorSelection {
  ticker: string;
  companyName: string | null;
  whyRelevant: string;
}

/** One row of the simple comparison table shown in the UI -- a
 * qualitative label per dimension, derived from (but simplifying) the
 * real CompanyMetricSet numbers. */
export interface ComparisonRow {
  ticker: string;
  companyName: string | null;
  growth: ComparisonLevel;
  profitability: ComparisonLevel;
  financialStrength: ComparisonLevel;
  valuation: ComparisonLevel;
  competitivePosition: ComparisonLevel;
}

export interface CompetitiveFactor {
  factor: string;
  explanation: string;
}

export interface CompetitorAnalysisInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  competitiveScore: number; // -100..100
  confidenceScore: number; // 0..1

  competitorSelections: CompetitorSelection[];
  comparisonTable: ComparisonRow[]; // includes the primary company + competitors

  whoIsWinning: string; // plain-language summary
  companyStrengths: CompetitiveFactor[];
  companyWeaknesses: CompetitiveFactor[];
  biggestCompetitiveThreat: string;

  overallConclusion: string;
}

export interface CompetitorAnalysisResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  primaryCompany: CompanyMetricSet;
  competitors: CompanyMetricSet[];
  interpretation: CompetitorAnalysisInterpretation;
}
