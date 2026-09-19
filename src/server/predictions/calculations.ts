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
import { isCallCorrect, isFlatCall, stayedFlat } from "@/lib/prediction-scoring";

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
/** Higher than MIN_SAMPLE_PER_HORIZON on purpose: showing a rough
 * accuracy figure early is harmless, but declaring that the pipeline
 * beats a naive baseline is a much stronger claim and needs a real
 * sample behind it. Same gate the chart-pattern backtest uses. */
const MIN_SAMPLE_FOR_EDGE_VERDICT = 30;
/** Predictions made in the same week share one market move, so a verdict
 * also needs predictions spread across several separate weeks. Four is a
 * floor, not a guarantee: it stops a single broad rally or selloff from
 * deciding the result on its own. */
const MIN_WEEKS_FOR_EDGE_VERDICT = 4;
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
 * compares the predicted and actual buckets.
 *
 * NOTE: this three-outcome result is still written to each prediction
 * record when it's evaluated (the database column already exists), but
 * NO statistic or UI label reads it any more. Every accuracy figure uses
 * `isCallCorrect` from @/lib/prediction-scoring instead, which grades the
 * AI by the same up-or-down rule as the "no analysis" baseline. See that
 * file for why the three-outcome rule made the comparison unfair. */
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
  if (horizon === "1_week") {
    due.setDate(due.getDate() + 7);
    return due;
  }
  const monthsToAdd = horizon === "1_month" ? 1 : horizon === "3_month" ? 3 : horizon === "6_month" ? 6 : 12;
  due.setMonth(due.getMonth() + monthsToAdd);
  return due;
}

export function isReadyForEvaluation(evaluationDueDate: Date, now: Date = new Date()): boolean {
  return now.getTime() >= evaluationDueDate.getTime();
}

// --- Aggregate statistics over already-evaluated predictions ---

/** A prediction counts as evaluated once it has an evaluation date and a
 * real actual return -- the two things every statistic here reads. It
 * no longer depends on the stored three-outcome `directionCorrect`
 * flag, which nothing reads any more (see determineDirectionCorrect). */
function evaluatedOnly(predictions: PredictionRecord[]): PredictionRecord[] {
  return predictions.filter((p) => p.evaluatedAt !== null && p.actualReturnPct !== null);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Evaluated predictions that make a gradeable direction call (see
 * `isCallCorrect`), paired with the result. Accuracy, the baseline and
 * the simulated returns all draw from exactly this set, so none of them
 * is computed over different predictions than the others. */
function scoredCalls(predictions: PredictionRecord[]): { p: PredictionRecord; correct: boolean }[] {
  const out: { p: PredictionRecord; correct: boolean }[] = [];
  for (const p of evaluatedOnly(predictions)) {
    const correct = isCallCorrect(p.expectedReturnPct, p.actualReturnPct);
    if (correct !== null) out.push({ p, correct });
  }
  return out;
}

/** Identifies the calendar week (Monday start, UTC) a prediction was
 * made in, used only to count how many separate weeks a sample spans. */
function weekKey(isoDate: string): string {
  const d = new Date(isoDate);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export function computeAccuracyByHorizon(
  predictions: PredictionRecord[],
  horizons: ForecastHorizonKey[] = ["1_week", "1_month", "3_month", "6_month", "12_month"]
): HorizonAccuracy[] {
  return horizons.map((horizon) => {
    const scored = scoredCalls(predictions.filter((p) => p.horizon === horizon));
    const n = scored.length;
    const correct = scored.filter((s) => s.correct).length;

    const directionAccuracyPct = n >= MIN_SAMPLE_PER_HORIZON ? (correct / n) * 100 : null;

    // The naive baseline, over EXACTLY the same predictions and scored by
    // the same up-or-down rule: how well "always guess whichever way the
    // market actually went" would have done. That, not 50%, is the bar.
    const upCount = scored.filter((s) => (s.p.actualReturnPct as number) > 0).length;
    const upRate = n === 0 ? null : upCount / n;
    const baselineRate = upRate === null ? null : Math.max(upRate, 1 - upRate);
    const baselineAccuracyPct =
      baselineRate === null || n < MIN_SAMPLE_PER_HORIZON ? null : baselineRate * 100;

    const edgePct =
      directionAccuracyPct === null || baselineAccuracyPct === null
        ? null
        : directionAccuracyPct - baselineAccuracyPct;

    const accuracyRate = n === 0 ? 0 : correct / n;
    const standardErrorPct =
      n < MIN_SAMPLE_PER_HORIZON ? null : Math.sqrt((accuracyRate * (1 - accuracyRate)) / n) * 100;

    const distinctWeeks = new Set(scored.map((s) => weekKey(s.p.predictionDate))).size;

    const isEdgeMeaningful =
      n >= MIN_SAMPLE_FOR_EDGE_VERDICT &&
      distinctWeeks >= MIN_WEEKS_FOR_EDGE_VERDICT &&
      edgePct !== null &&
      standardErrorPct !== null &&
      Math.abs(edgePct) > 2 * standardErrorPct;

    // Flat calls are graded separately: did a predicted small move
    // actually stay small? Drawn from all evaluated predictions for the
    // horizon, since a flat call is gradeable even when the direction
    // call wasn't (e.g. the stock finished exactly unchanged).
    const flatCalls = evaluatedOnly(predictions).filter(
      (p) => p.horizon === horizon && p.actualReturnPct !== null && isFlatCall(p.expectedReturnPct)
    );
    const flatStayed = flatCalls.filter((p) => stayedFlat(p.actualReturnPct as number)).length;

    return {
      horizon,
      evaluatedCount: n,
      correctCount: correct,
      directionAccuracyPct,
      baselineAccuracyPct,
      edgePct,
      standardErrorPct,
      distinctWeeks,
      isEdgeMeaningful,
      flatCallCount: flatCalls.length,
      flatCallStayedFlatPct:
        flatCalls.length >= MIN_SAMPLE_PER_HORIZON ? (flatStayed / flatCalls.length) * 100 : null,
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
  const scored = scoredCalls(predictions);

  if (scored.length < MIN_SAMPLE_FOR_CALIBRATION) {
    return {
      verdict: "insufficient_data",
      averageStatedConfidence: null,
      actualAccuracyPct: null,
      explanation: `Not enough evaluated predictions yet (${scored.length} of ${MIN_SAMPLE_FOR_CALIBRATION} needed) to judge whether the AI's confidence is well calibrated.`,
    };
  }

  const distinctWeeks = new Set(scored.map((s) => weekKey(s.p.predictionDate))).size;
  if (distinctWeeks < MIN_WEEKS_FOR_EDGE_VERDICT) {
    // Same reasoning as the edge verdict: one week's market move can make
    // any forecaster look over- or under-confident for reasons that have
    // nothing to do with how its confidence is calibrated.
    return {
      verdict: "insufficient_data",
      averageStatedConfidence: null,
      actualAccuracyPct: null,
      explanation: `These predictions come from ${distinctWeeks} week${distinctWeeks === 1 ? "" : "s"} so far; at least ${MIN_WEEKS_FOR_EDGE_VERDICT} separate weeks are needed so a single market move can't decide whether the AI is over- or under-confident.`,
    };
  }

  const avgConfidence = average(scored.map((s) => s.p.confidenceScore))!;
  const accuracyPct = (scored.filter((s) => s.correct).length / scored.length) * 100;
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
  // Follow each call: long if the AI predicted up, short if it predicted
  // down. The return is signed in the call's favour, so a correct bearish
  // call is a gain. Only predictions that make a gradeable call are
  // included -- the same set the accuracy figures use.
  const returns = scoredCalls(predictions).map(({ p }) =>
    p.expectedReturnPct > 0 ? (p.actualReturnPct as number) : -(p.actualReturnPct as number)
  );

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

  // Cumulative return: compounding each call's return as if taken in
  // sequence -- a simplification (real trades would overlap in time, and
  // short-selling has costs and risks this ignores), clearly labeled as
  // simulated, not a claim of actual trading results.
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
  const scored = scoredCalls(predictions);
  const correctCount = scored.filter((s) => s.correct).length;
  const incorrectCount = scored.length - correctCount;

  const overallAccuracyPct =
    scored.length >= MIN_SAMPLE_FOR_OVERALL_ACCURACY ? (correctCount / scored.length) * 100 : null;

  return {
    generatedAt: new Date().toISOString(),
    totalPredictions: predictions.length,
    evaluatedPredictions: evaluated.length,
    pendingPredictions: predictions.length - evaluated.length,

    overallDirectionAccuracyPct: overallAccuracyPct,
    insufficientSampleMessage:
      overallAccuracyPct === null
        ? `Not enough historical predictions yet (${scored.length} of ${MIN_SAMPLE_FOR_OVERALL_ACCURACY} needed to show an accuracy percentage).`
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
