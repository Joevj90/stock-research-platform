import type { ForecastHorizonKey } from "@/lib/forecast-types";
import type {
  AccuracyDashboard,
  ConfidenceCalibration,
  FiveWayRating,
  HorizonAccuracy,
  PredictionRecord,
  RangeAccuracy,
  RangeOutcome,
  RatingPerformance,
  SimulatedPerformance,
} from "@/lib/prediction-types";

/**
 * Deterministic prediction-tracking arithmetic -- "Perform all
 * calculations programmatically. Do NOT rely on the LLM for
 * arithmetic." Every function here is pure math over real numbers
 * (predicted values already stored at prediction time, and a real
 * fetched current price at evaluation time). No AI involvement
 * anywhere in this file.
 */

const DIRECTION_FLAT_THRESHOLD_PCT = 2; // "account for predictions near zero where the difference is insignificant"
const MIN_SAMPLE_FOR_OVERALL_ACCURACY = 5;
const MIN_SAMPLE_PER_HORIZON = 3;
const MIN_SAMPLE_FOR_CALIBRATION = 10;

export function computeActualReturnPct(actualPrice: number, originalPrice: number): number {
  if (originalPrice <= 0) return 0;
  return ((actualPrice - originalPrice) / originalPrice) * 100;
}

export function computePredictionErrorAbs(actualPrice: number, predictedPrice: number): number {
  return actualPrice - predictedPrice;
}

export function computePredictionErrorPct(actualPrice: number, predictedPrice: number): number {
  if (predictedPrice <= 0) return 0;
  return ((actualPrice - predictedPrice) / predictedPrice) * 100;
}

/** Buckets a return into up/flat/down using a small threshold so
 * near-zero moves aren't treated as a meaningful direction, then
 * compares the predicted and actual buckets. */
export function determineDirectionCorrect(predictedReturnPct: number, actualReturnPct: number): boolean {
  return bucketDirection(predictedReturnPct) === bucketDirection(actualReturnPct);
}

function bucketDirection(returnPct: number): "up" | "flat" | "down" {
  if (returnPct > DIRECTION_FLAT_THRESHOLD_PCT) return "up";
  if (returnPct < -DIRECTION_FLAT_THRESHOLD_PCT) return "down";
  return "flat";
}

/** Classifies where the actual price landed relative to the three
 * scenario prices. "outside" if it fell outside the bear-to-bull range
 * entirely; otherwise the scenario price it ended up closest to. */
export function determineRangeOutcome(
  actualPrice: number,
  bearPrice: number,
  basePrice: number,
  bullPrice: number
): RangeOutcome {
  const low = Math.min(bearPrice, bullPrice);
  const high = Math.max(bearPrice, bullPrice);
  if (actualPrice < low || actualPrice > high) return "outside";

  const distances: [RangeOutcome, number][] = [
    ["bear", Math.abs(actualPrice - bearPrice)],
    ["base", Math.abs(actualPrice - basePrice)],
    ["bull", Math.abs(actualPrice - bullPrice)],
  ];
  return distances.reduce((closest, current) => (current[1] < closest[1] ? current : closest))[0];
}

/** Deterministic 5-way rating derived from the Forecasting Agent's own
 * real expected return and confidence -- no separate rating agent is
 * required for this. Documented thresholds, not arbitrary per-call
 * guesses. */
export function deriveFiveWayRating(expectedReturnPct: number, confidenceScore: number): FiveWayRating {
  const highConfidence = confidenceScore >= 65;
  if (expectedReturnPct >= 15) return highConfidence ? "strong_bullish" : "bullish";
  if (expectedReturnPct >= 5) return "bullish";
  if (expectedReturnPct > -5) return "neutral";
  if (expectedReturnPct > -15) return "bearish";
  return highConfidence ? "strong_bearish" : "bearish";
}

export function computeEvaluationDueDate(predictionDate: Date, horizon: ForecastHorizonKey): Date {
  const due = new Date(predictionDate);
  const monthsToAdd = horizon === "3_month" ? 3 : horizon === "6_month" ? 6 : 12;
  due.setMonth(due.getMonth() + monthsToAdd);
  return due;
}

export function isReadyForEvaluation(evaluationDueDate: Date, now: Date = new Date()): boolean {
  return now.getTime() >= evaluationDueDate.getTime();
}

// --- Aggregate statistics over already-evaluated predictions ---

function evaluatedOnly(predictions: PredictionRecord[]): PredictionRecord[] {
  return predictions.filter((p) => p.evaluatedAt !== null && p.directionCorrect !== null);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function computeAccuracyByHorizon(
  predictions: PredictionRecord[],
  horizons: ForecastHorizonKey[] = ["3_month", "6_month", "12_month"]
): HorizonAccuracy[] {
  return horizons.map((horizon) => {
    const evaluated = evaluatedOnly(predictions).filter((p) => p.horizon === horizon);
    const correct = evaluated.filter((p) => p.directionCorrect === true).length;
    return {
      horizon,
      evaluatedCount: evaluated.length,
      correctCount: correct,
      directionAccuracyPct: evaluated.length >= MIN_SAMPLE_PER_HORIZON ? (correct / evaluated.length) * 100 : null,
    };
  });
}

export function computeRangeAccuracy(predictions: PredictionRecord[]): RangeAccuracy {
  const evaluated = predictions.filter((p) => p.rangeOutcome !== null);
  return {
    bearCount: evaluated.filter((p) => p.rangeOutcome === "bear").length,
    baseCount: evaluated.filter((p) => p.rangeOutcome === "base").length,
    bullCount: evaluated.filter((p) => p.rangeOutcome === "bull").length,
    outsideCount: evaluated.filter((p) => p.rangeOutcome === "outside").length,
    totalEvaluated: evaluated.length,
  };
}

export function computeRatingPerformance(predictions: PredictionRecord[]): RatingPerformance[] {
  const ratings: FiveWayRating[] = ["strong_bullish", "bullish", "neutral", "bearish", "strong_bearish"];
  const evaluated = evaluatedOnly(predictions);

  return ratings.map((rating) => {
    const matching = evaluated.filter((p) => p.aiRating === rating);
    return {
      rating,
      count: matching.length,
      averageActualReturnPct: average(matching.map((p) => p.actualReturnPct!)),
    };
  });
}

export function computeConfidenceCalibration(predictions: PredictionRecord[]): ConfidenceCalibration {
  const evaluated = evaluatedOnly(predictions);

  if (evaluated.length < MIN_SAMPLE_FOR_CALIBRATION) {
    return {
      verdict: "insufficient_data",
      averageStatedConfidence: null,
      actualAccuracyPct: null,
      explanation: `Not enough evaluated predictions yet (${evaluated.length} of ${MIN_SAMPLE_FOR_CALIBRATION} needed) to judge whether the AI's confidence is well calibrated.`,
    };
  }

  const avgConfidence = average(evaluated.map((p) => p.confidenceScore))!;
  const accuracyPct = (evaluated.filter((p) => p.directionCorrect === true).length / evaluated.length) * 100;
  const gap = avgConfidence - accuracyPct;

  let verdict: ConfidenceCalibration["verdict"];
  let explanation: string;
  if (gap > 15) {
    verdict = "overconfident";
    explanation = `The AI's average stated confidence (${avgConfidence.toFixed(0)}%) is notably higher than how often its predictions have actually been correct (${accuracyPct.toFixed(0)}%). The AI appears to be more confident than its results justify.`;
  } else if (gap < -15) {
    verdict = "underconfident";
    explanation = `The AI's actual accuracy (${accuracyPct.toFixed(0)}%) has been higher than its average stated confidence (${avgConfidence.toFixed(0)}%) would suggest. The AI may be more accurate than it lets on.`;
  } else {
    verdict = "reasonably_calibrated";
    explanation = `The AI's average stated confidence (${avgConfidence.toFixed(0)}%) is reasonably close to its actual accuracy (${accuracyPct.toFixed(0)}%).`;
  }

  return { verdict, averageStatedConfidence: avgConfidence, actualAccuracyPct: accuracyPct, explanation };
}

export function computeSimulatedPerformance(predictions: PredictionRecord[]): SimulatedPerformance {
  const evaluated = evaluatedOnly(predictions);
  const returns = evaluated.map((p) => p.actualReturnPct!);

  if (returns.length === 0) {
    return {
      label: "SIMULATED / HISTORICAL — NOT ACTUAL TRADING RESULTS",
      evaluatedCount: 0,
      cumulativeReturnPct: null,
      averageReturnPct: null,
      winningCount: 0,
      losingCount: 0,
      largestGainPct: null,
      largestLossPct: null,
      maxDrawdownPct: null,
    };
  }

  // Cumulative return: compounding each prediction's return as if taken
  // in sequence -- a simplification (real trades would overlap in time),
  // clearly labeled as simulated, not a claim of actual trading results.
  const cumulativeMultiplier = returns.reduce((acc, r) => acc * (1 + r / 100), 1);
  const cumulativeReturnPct = (cumulativeMultiplier - 1) * 100;

  let peak = 1;
  let runningMultiplier = 1;
  let maxDrawdownPct = 0;
  for (const r of returns) {
    runningMultiplier *= 1 + r / 100;
    peak = Math.max(peak, runningMultiplier);
    const drawdown = ((peak - runningMultiplier) / peak) * 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
  }

  return {
    label: "SIMULATED / HISTORICAL — NOT ACTUAL TRADING RESULTS",
    evaluatedCount: returns.length,
    cumulativeReturnPct,
    averageReturnPct: average(returns),
    winningCount: returns.filter((r) => r > 0).length,
    losingCount: returns.filter((r) => r < 0).length,
    largestGainPct: Math.max(...returns),
    largestLossPct: Math.min(...returns),
    maxDrawdownPct,
  };
}

export function buildAccuracyDashboard(predictions: PredictionRecord[]): AccuracyDashboard {
  const evaluated = evaluatedOnly(predictions);
  const correctCount = evaluated.filter((p) => p.directionCorrect === true).length;
  const incorrectCount = evaluated.length - correctCount;

  const overallAccuracyPct =
    evaluated.length >= MIN_SAMPLE_FOR_OVERALL_ACCURACY ? (correctCount / evaluated.length) * 100 : null;

  return {
    generatedAt: new Date().toISOString(),
    totalPredictions: predictions.length,
    evaluatedPredictions: evaluated.length,
    pendingPredictions: predictions.length - evaluated.length,

    overallDirectionAccuracyPct: overallAccuracyPct,
    insufficientSampleMessage:
      overallAccuracyPct === null
        ? `Not enough historical predictions yet (${evaluated.length} of ${MIN_SAMPLE_FOR_OVERALL_ACCURACY} needed to show an accuracy percentage).`
        : null,

    correctCount,
    incorrectCount,
    averagePredictionErrorPct: average(evaluated.map((p) => p.predictionErrorPct!)),
    averageActualReturnPct: average(evaluated.map((p) => p.actualReturnPct!)),
    averagePredictedReturnPct: average(evaluated.map((p) => p.expectedReturnPct)),

    accuracyByHorizon: computeAccuracyByHorizon(predictions),
    rangeAccuracy: computeRangeAccuracy(predictions),
    ratingPerformance: computeRatingPerformance(predictions),
    confidenceCalibration: computeConfidenceCalibration(predictions),
    simulatedPerformance: computeSimulatedPerformance(predictions),
  };
}
