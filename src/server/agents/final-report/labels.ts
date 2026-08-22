import type { QualityLabel } from "@/lib/final-report-types";

/**
 * Deterministic label bucketing -- turns a real numeric score already
 * produced by an upstream agent into one of the spec's required labels
 * (STRONG/GOOD/AVERAGE/WEAK/VERY_WEAK). This is formatting, not new
 * analysis: no number here is calculated from raw data, only classified
 * from a score another agent already computed. `null` input always
 * yields "unavailable" -- never a guessed label for missing data.
 */

/** For -100..100 scores where higher is better (Fundamental, Competitor,
 * Management scores). */
export function bucketScoreNeg100To100(score: number | null): QualityLabel {
  if (score === null) return "unavailable";
  if (score >= 50) return "strong";
  if (score >= 20) return "good";
  if (score >= -20) return "average";
  if (score >= -50) return "weak";
  return "very_weak";
}

/** For the Risk Analyst's 0..100 score where LOWER is better (0 = very
 * low risk). Inverted relative to bucketScoreNeg100To100 since a "strong"
 * business-risk rating means low risk. */
export function bucketRiskScore0To100(score: number | null): QualityLabel {
  if (score === null) return "unavailable";
  if (score <= 20) return "strong";
  if (score <= 40) return "good";
  if (score <= 60) return "average";
  if (score <= 80) return "weak";
  return "very_weak";
}

/** For a real revenue growth percentage. */
export function bucketGrowthPct(pct: number | null): QualityLabel {
  if (pct === null) return "unavailable";
  if (pct >= 15) return "strong";
  if (pct >= 7) return "good";
  if (pct >= 0) return "average";
  if (pct >= -10) return "weak";
  return "very_weak";
}

/** For a real net margin percentage. */
export function bucketMarginPct(pct: number | null): QualityLabel {
  if (pct === null) return "unavailable";
  if (pct >= 20) return "strong";
  if (pct >= 10) return "good";
  if (pct >= 5) return "average";
  if (pct >= 0) return "weak";
  return "very_weak";
}
