import type { CommitteeRecommendation } from "@/lib/investment-committee-types";
import type { FinalReportResult } from "@/lib/final-report-types";

/**
 * Analysis History & Reassessment domain types (Step 19).
 *
 * FACT / CALCULATION / AI INTERPRETATION, mapped:
 *   - FACT           = every field on SavedAnalysisRecord -- copied
 *                       verbatim from a real, already-completed Final
 *                       Report, never re-derived or altered afterward.
 *   - CALCULATION    = ComparisonDeltas -- pure arithmetic between two
 *                       real saved analyses, computed in
 *                       `comparison-calculations.ts`, never asked of an
 *                       LLM.
 *   - AI INTERPRETATION = the "what changed and why does it matter"
 *                       narrative, thesis-change classification, and the
 *                       price-vs-business separation -- produced by a
 *                       small, focused interpreter that only runs when
 *                       the user explicitly clicks "Research Again," on
 *                       real data from two real saved analyses.
 *
 * This module never re-runs or re-derives any of Steps 1-17's own
 * analysis -- "Research Again" is simply running the existing Final
 * Report flow again (the same real functions, called the same way),
 * saving the result, and comparing it against what was saved last time.
 */

export type ThesisChangeLevel = "no_significant_change" | "slightly_changed" | "significantly_changed" | "completely_changed";
export type ChangeDirection = "improved" | "weakened" | "no_effect" | "uncertain";

export interface SavedAnalysisRecord {
  id: string;
  ticker: string;
  companyName: string | null;
  analysisDate: string;

  priceAtAnalysis: number;
  rating: CommitteeRecommendation;
  confidenceScore: number;
  bearPrice: number;
  basePrice: number;
  bullPrice: number;
  expectedPrice: number;
  expectedReturnPct: number;
  bearProbabilityPct: number;
  baseProbabilityPct: number;
  bullProbabilityPct: number;

  valuationConclusion: string;
  sentimentConclusion: string;
  macroConclusion: string;
  competitorConclusion: string;
  managementConclusion: string;
  committeeConclusion: string;
  devilsAdvocateConclusion: string;
  bottomLine: string;

  majorAssumptions: string[];
  majorRisks: string[];
  majorCatalysts: string[];
  keyNewsFindings: { headline: string; url: string; source: string; whatHappened: string }[];
}

/** The full historical report, for "view the full report that existed
 * at that time" -- returned separately from the lighter list view since
 * it's a much larger payload. */
export interface SavedAnalysisWithReport extends SavedAnalysisRecord {
  fullReport: FinalReportResult;
}

/** Deterministic deltas between two real saved analyses -- pure
 * arithmetic, computed before any AI call. */
export interface ComparisonDeltas {
  priceChangePct: number;
  expectedPriceChangePct: number;
  confidenceChangePts: number; // percentage-point change, not percent-of-percent
  expectedReturnChangePts: number;
  ratingChanged: boolean;
  daysBetweenAnalyses: number;
}

export interface WhatChangedItem {
  whatChanged: string;
  whyItMatters: string;
  direction: ChangeDirection;
}

export interface ComparisonResult {
  previous: SavedAnalysisRecord;
  current: SavedAnalysisRecord;
  deltas: ComparisonDeltas;

  whatChanged: WhatChangedItem[]; // 3-7 items, per spec

  thesisChangeLevel: ThesisChangeLevel;
  thesisChangeExplanation: string;

  ratingChangeExplanation: string; // explains why the rating did or didn't change

  priceRelatedChanges: string[]; // "what changed because of the stock price"
  businessRelatedChanges: string[]; // "what changed because of the business"

  whatImproved: string[];
  whatGotWorse: string[];
  whatStayedTheSame: string[];
  whyOpinionChanged: string; // 2-5 sentences
  finalBottomLine: string;
}

export interface AnalysisHistoryResult {
  ticker: string;
  analyses: SavedAnalysisRecord[]; // newest first
  latestComparison: ComparisonResult | null; // null if fewer than 2 analyses exist
}
