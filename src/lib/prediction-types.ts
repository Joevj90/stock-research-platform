import type { ForecastHorizonKey } from "@/lib/forecast-types";

/**
 * Prediction Tracking domain types.
 *
 * FACT / CALCULATION, mapped:
 *   - FACT        = every field written at prediction creation time
 *                   (prices, probabilities, rating, assumptions, risks)
 *                   -- copied directly from a real ForecastResult,
 *                   never re-derived, never overwritten afterward.
 *   - CALCULATION = every evaluation field (actualReturnPct,
 *                   predictionErrorPct, directionCorrect, rangeOutcome)
 *                   and every aggregate accuracy statistic -- pure
 *                   arithmetic over real stored data and a real fetched
 *                   current price, computed in `calculations.ts`, never
 *                   asked of an LLM.
 *
 * This module has no AI interpretation layer at all -- tracking and
 * grading past predictions is inherently a factual/statistical exercise,
 * not a judgment call.
 */

export type FiveWayRating = "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
export type RangeOutcome = "bear" | "base" | "bull" | "outside";
export type CalibrationVerdict = "underconfident" | "reasonably_calibrated" | "overconfident" | "insufficient_data";

/** One immutable prediction record, exactly as originally made. */
export interface PredictionRecord {
  id: string;
  ticker: string;
  companyName: string | null;
  horizon: ForecastHorizonKey;
  predictionDate: string; // ISO datetime
  evaluationDueDate: string; // ISO datetime
  priceAtPrediction: number;
  bearPrice: number;
  basePrice: number;
  bullPrice: number;
  expectedPrice: number;
  expectedReturnPct: number;
  bearProbabilityPct: number;
  baseProbabilityPct: number;
  bullProbabilityPct: number;
  aiRating: FiveWayRating;
  confidenceScore: number;
  keyAssumptions: string[];
  majorRisks: string[];
  predictionVersion: string;

  // Evaluation -- null until the horizon has elapsed and it's been checked.
  actualPrice: number | null;
  evaluatedAt: string | null;
  actualReturnPct: number | null;
  predictionErrorAbs: number | null;
  predictionErrorPct: number | null;
  directionCorrect: boolean | null;
  rangeOutcome: RangeOutcome | null;
}

export interface HorizonAccuracy {
  horizon: ForecastHorizonKey;
  evaluatedCount: number;
  correctCount: number;
  directionAccuracyPct: number | null; // null if evaluatedCount is below the minimum sample size
}

export interface RangeAccuracy {
  bearCount: number;
  baseCount: number;
  bullCount: number;
  outsideCount: number;
  totalEvaluated: number;
}

export interface RatingPerformance {
  rating: FiveWayRating;
  count: number;
  averageActualReturnPct: number | null;
}

export interface ConfidenceCalibration {
  verdict: CalibrationVerdict;
  averageStatedConfidence: number | null; // 0..100
  actualAccuracyPct: number | null; // 0..100
  explanation: string;
}

export interface SimulatedPerformance {
  label: "SIMULATED / HISTORICAL — NOT ACTUAL TRADING RESULTS";
  evaluatedCount: number;
  cumulativeReturnPct: number | null;
  averageReturnPct: number | null;
  winningCount: number;
  losingCount: number;
  largestGainPct: number | null;
  largestLossPct: number | null;
  maxDrawdownPct: number | null;
}

export interface AccuracyDashboard {
  generatedAt: string;
  totalPredictions: number;
  evaluatedPredictions: number;
  pendingPredictions: number;

  /** null (with `insufficientSampleMessage` explaining why) until enough
   * evaluated predictions exist -- "do not calculate a misleading
   * accuracy percentage from only a few predictions." */
  overallDirectionAccuracyPct: number | null;
  insufficientSampleMessage: string | null;

  correctCount: number;
  incorrectCount: number;
  averagePredictionErrorPct: number | null;
  averageActualReturnPct: number | null;
  averagePredictedReturnPct: number | null;

  accuracyByHorizon: HorizonAccuracy[];
  rangeAccuracy: RangeAccuracy;
  ratingPerformance: RatingPerformance[];
  confidenceCalibration: ConfidenceCalibration;
  simulatedPerformance: SimulatedPerformance;
}

export interface PredictionHistoryResult {
  ticker: string;
  predictions: PredictionRecord[]; // oldest first
}
