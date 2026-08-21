/**
 * Management Analysis domain types.
 *
 * FACT / CALCULATION / AI INTERPRETATION / CONCLUSION, mapped:
 *   - FACT           = real insider transactions (this file's imports
 *                       from insider-trading-types.ts) and the real
 *                       financial-statement figures (Step 5) that
 *                       CapitalAllocationSignal is built from.
 *   - CALCULATION    = CapitalAllocationSignal + InsiderActivitySummary
 *                       below -- deterministic, zero AI.
 *   - AI INTERPRETATION = ManagementInterpretation below -- tagged
 *                       `source: "ai"`.
 *   - CONCLUSION     = `overallConclusion` -- never presented as fact.
 *
 * IMPORTANT: this app has NO source of historical management guidance
 * statements (e.g. "revenue expected to grow 20%") or their outcomes.
 * `trackRecordVsGuidance` is therefore always explicitly marked
 * unavailable rather than letting the AI recall or estimate specific
 * guidance figures from general training knowledge it cannot attach a
 * verified source/date to for this app.
 */

export type ManagementRating = "strong" | "good" | "neutral" | "concerning" | "very_concerning";
export type CredibilityRating = "high" | "medium" | "low" | "insufficient_data";
export type TrendDirection = "increasing" | "decreasing" | "flat" | "unavailable";

/** One real financial trend, computed deterministically from Step 5 data
 * across the two most recent periods. */
export interface CapitalAllocationTrend {
  direction: TrendDirection;
  latestValue: number | null;
  priorValue: number | null;
  changePct: number | null;
}

/** Deterministic capital-allocation signals -- pure arithmetic over real
 * financial-statement history (Step 5). No AI, no fabrication. */
export interface CapitalAllocationSignal {
  source: "calculated";
  dividendsPaidTrend: CapitalAllocationTrend;
  totalDebtTrend: CapitalAllocationTrend;
  cashTrend: CapitalAllocationTrend;
  freeCashFlowTrend: CapitalAllocationTrend;
  /** A falling implied share count (net income / eps) across periods is
   * a real, derivable signal consistent with share buybacks -- not a
   * direct "shares repurchased" figure (this app doesn't have that field),
   * but a defensible inference from two real reported numbers. */
  impliedSharesOutstandingTrend: CapitalAllocationTrend;
}

/** Deterministic aggregation of real insider transactions -- no AI. */
export interface InsiderActivitySummary {
  source: "calculated";
  transactionCount: number;
  purchaseCount: number;
  saleCount: number;
  netSharesPurchased: number; // purchases minus sales, in shares
  mostRecentTransactionDate: string | null;
}

export interface ManagementFactor {
  factor: string;
  explanation: string;
}

export interface ManagementInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  managementScore: number; // -100..100
  overallAssessment: ManagementRating;
  confidenceScore: number; // 0..1

  whatManagementIsDoingWell: ManagementFactor[];
  managementConcerns: ManagementFactor[];

  /** Always explicitly "unavailable" in this build -- see the type-level
   * comment above for why. */
  trackRecordVsGuidance: string;

  capitalAllocationAssessment: string;
  insiderActivityAssessment: string;

  managementCredibility: CredibilityRating;
  managementCredibilityExplanation: string;

  overallConclusion: string;
}

export interface ManagementAnalysisResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  capitalAllocation: CapitalAllocationSignal;
  insiderActivity: InsiderActivitySummary;
  recentInsiderTransactionCount: number;
  interpretation: ManagementInterpretation;
}
