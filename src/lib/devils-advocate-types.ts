import type { CommitteeRecommendation } from "@/lib/investment-committee-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";

/**
 * Devil's Advocate domain types.
 *
 * FACT / CALCULATION / ASSUMPTION / AI INTERPRETATION / CHALLENGE /
 * FINAL CONCLUSION, mapped:
 *   - FACT               = the real Investment Committee rating/vote and
 *                           Forecasting Agent scenario data this agent
 *                           reviews (via the same shared gatherer + real
 *                           `runForecast`/`runInvestmentCommittee` calls).
 *   - CALCULATION        = none produced fresh in this step -- this
 *                           agent reasons over already-calculated numbers
 *                           from Forecast/Committee, never recomputing.
 *   - ASSUMPTION         = QuestionableAssumption below -- explicit,
 *                           never presented as fact.
 *   - AI INTERPRETATION  = the critique content generally (weaknesses,
 *                           alternative interpretations, confidence
 *                           concerns) -- tagged `source: "ai"`.
 *   - CHALLENGE          = `overallChallengeScore` and `challengeLevel`
 *                           -- explicitly framed as "how strongly should
 *                           this be challenged", NOT a bearish score.
 *   - FINAL CONCLUSION   = `finalConclusion` and `committeeReview` --
 *                           never presented as more certain than the
 *                           evidence supports.
 */

export type WeaknessSeverity = "low" | "medium" | "high" | "critical";
export type ChallengeLevel = "low" | "moderate" | "high" | "very_high";
export type ThesisChangeVerdict = "yes" | "no" | "possibly";

export interface Weakness {
  problem: string;
  evidence: string;
  whyItMatters: string;
  severity: WeaknessSeverity;
  couldChangeConclusion: boolean;
  recommendedAdjustment: string | null;
}

export interface AlternativeInterpretation {
  fact: string; // the real, given piece of evidence
  commonInterpretation: string; // the "obvious" positive/negative reading
  alternativeInterpretation: string; // a reasonable different reading
}

export interface ConfidenceConcern {
  concern: string;
  explanation: string;
}

export interface DevilsAdvocateInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  overallChallengeScore: number; // 0..100 -- NOT a bearish score, see type-doc above
  challengeLevel: ChallengeLevel;

  majorWeaknesses: Weakness[];
  overlookedRisks: string[];
  questionableAssumptions: string[];
  contradictoryEvidence: string[];
  alternativeInterpretations: AlternativeInterpretation[];
  confidenceConcerns: ConfidenceConcern[];

  whatAssumptionWorriesMost: string;
  couldThisChangeTheRating: ThesisChangeVerdict;
  whyChangeOrNot: string;

  recommendedChanges: string[];
  finalConclusion: string;
}

/**
 * "Send findings back to the Investment Committee" -- whether the
 * committee's conclusion actually changes, produced by the same AI call
 * that generated the critique (since it has full context of both the
 * critique and the original conclusion already), never applied
 * automatically. `wasThesisRevised` is false unless the critique
 * genuinely justified a change.
 */
export interface CommitteeReview {
  wasThesisRevised: boolean;
  revisedRating: CommitteeRecommendation | null;
  revisedConfidence: number | null;
  whatChangedAndWhy: string | null;
}

export interface DevilsAdvocateResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  originalCommitteeRating: CommitteeRecommendation;
  originalCommitteeConfidence: number;
  interpretation: DevilsAdvocateInterpretation;
  committeeReview: CommitteeReview;
  /** The full underlying evidence/Forecast/Committee results this
   * critique was built on -- exposed so callers that need more than the
   * critique itself (the Final Report, Step 17) don't have to re-derive
   * them. `forecast` is null only if Forecasting Agent itself failed;
   * `committee` and `gathered` are always present since this function
   * returns an error instead of a result when the Committee is
   * unavailable. */
  gathered: GatheredAnalysisInputs;
  forecast: ForecastResult | null;
  committee: CommitteeResult;
}
