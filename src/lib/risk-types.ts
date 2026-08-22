import type { TrendDirection } from "@/lib/management-types";

/**
 * Risk Analyst domain types.
 *
 * FACT / CALCULATION / ASSUMPTION / AI INTERPRETATION / RISK ASSESSMENT,
 * mapped:
 *   - FACT              = the real price, financial-statement, macro, and
 *                          news-event data this agent reuses from Steps 1,
 *                          5, 7, 10, and 12 -- never restated here.
 *   - CALCULATION       = RiskFactorSignals below -- deterministic,
 *                          real-data trends and figures, zero AI.
 *   - ASSUMPTION        = implicit in any "potential impact" statement --
 *                          the AI is instructed to frame these as
 *                          possibilities dependent on stated conditions,
 *                          never as certain outcomes.
 *   - AI INTERPRETATION  = the qualitative reasoning behind each risk
 *                          (why it matters, what would confirm/reduce it).
 *   - RISK ASSESSMENT   = RiskItem's severity/probability/riskScore --
 *                          explicitly framed as the agent's judgment, not
 *                          a measured fact.
 */

export type RiskSeverity = "low" | "medium" | "high" | "very_high";
export type RiskProbability = "low" | "medium" | "high";
export type RiskTimeHorizon = "short_term" | "medium_term" | "long_term";
export type RiskLevel = "low" | "medium" | "high" | "very_high";

/** Deterministic, real-data risk-relevant signals -- pure arithmetic
 * (reusing existing shared functions where possible) over Steps 1, 5, and
 * 10's real data. No AI, no fabrication. */
export interface RiskFactorSignals {
  source: "calculated";
  volatilityAnnualizedPct: number | null;
  revenueGrowthTrend: TrendDirection;
  revenueGrowthPct: number | null;
  netMarginTrend: TrendDirection;
  netMarginPct: number | null;
  totalDebtTrend: TrendDirection;
  cashTrend: TrendDirection;
  freeCashFlowTrend: TrendDirection;
  debtToCashRatio: number | null; // a simple leverage/liquidity reference point
  simplePeRatio: number | null;
  /** Real macro context (e.g. interest rate, inflation), reused from Step
   * 10 -- included so the AI can reason about macro-sensitive risks
   * without a second macro fetch. */
  macroIndicatorSummary: { name: string; label: string; value: number; unit: string }[];
}

export interface RiskItem {
  risk: string; // short label
  evidence: string; // grounded in real data/news given to the AI
  severity: RiskSeverity;
  probability: RiskProbability;
  potentialImpact: string; // plain language, framed as a possibility
  timeFrame: RiskTimeHorizon;
  whatWouldConfirmIt: string;
  whatWouldReduceIt: string;
}

export interface RiskInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  riskScore: number; // 0..100
  riskLevel: RiskLevel;
  confidenceScore: number; // 0..1

  biggestRisks: RiskItem[]; // 3-5, per spec
  numberOneRisk: RiskItem;

  whatWouldMakeMoreBearish: string[];
  whatWouldMakeLessWorried: string[];

  overallConclusion: string;
}

export interface RiskAnalysisResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  signals: RiskFactorSignals;
  newsEvidenceCount: number;
  interpretation: RiskInterpretation;
}
