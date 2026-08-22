import { describe, expect, it } from "vitest";
import {
  computeActualReturnPct,
  computePredictionErrorAbs,
  computePredictionErrorPct,
  determineDirectionCorrect,
  determineRangeOutcome,
  deriveFiveWayRating,
  computeEvaluationDueDate,
  isReadyForEvaluation,
  computeAccuracyByHorizon,
  computeRangeAccuracy,
  computeRatingPerformance,
  computeConfidenceCalibration,
  computeSimulatedPerformance,
  buildAccuracyDashboard,
} from "./calculations";
import type { PredictionRecord } from "@/lib/prediction-types";

function prediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: "pred_1",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    horizon: "3_month",
    predictionDate: "2026-01-01T00:00:00.000Z",
    evaluationDueDate: "2026-04-01T00:00:00.000Z",
    priceAtPrediction: 100,
    bearPrice: 90,
    basePrice: 110,
    bullPrice: 130,
    expectedPrice: 112,
    expectedReturnPct: 12,
    bearProbabilityPct: 20,
    baseProbabilityPct: 50,
    bullProbabilityPct: 30,
    aiRating: "bullish",
    confidenceScore: 70,
    keyAssumptions: [],
    majorRisks: [],
    predictionVersion: "v1",
    actualPrice: null,
    evaluatedAt: null,
    actualReturnPct: null,
    predictionErrorAbs: null,
    predictionErrorPct: null,
    directionCorrect: null,
    rangeOutcome: null,
    ...overrides,
  };
}

function evaluatedPrediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return prediction({
    actualPrice: 108,
    evaluatedAt: "2026-04-01T00:00:00.000Z",
    actualReturnPct: 8,
    predictionErrorAbs: -4,
    predictionErrorPct: -3.6,
    directionCorrect: true,
    rangeOutcome: "base",
    ...overrides,
  });
}

describe("computeActualReturnPct", () => {
  it("computes percentage return exactly per the spec's formula", () => {
    expect(computeActualReturnPct(120, 100)).toBeCloseTo(20, 5);
    expect(computeActualReturnPct(80, 100)).toBeCloseTo(-20, 5);
  });

  it("returns 0 rather than dividing by zero for a non-positive original price", () => {
    expect(computeActualReturnPct(100, 0)).toBe(0);
  });
});

describe("computePredictionErrorAbs / computePredictionErrorPct", () => {
  it("computes absolute error exactly per the spec's formula", () => {
    expect(computePredictionErrorAbs(105, 100)).toBe(5);
    expect(computePredictionErrorAbs(95, 100)).toBe(-5);
  });

  it("computes percentage error exactly per the spec's formula", () => {
    expect(computePredictionErrorPct(110, 100)).toBeCloseTo(10, 5);
  });

  it("returns 0 rather than dividing by zero for a non-positive predicted price", () => {
    expect(computePredictionErrorPct(100, 0)).toBe(0);
  });
});

describe("determineDirectionCorrect", () => {
  it("is correct when predicted and actual are both clearly up", () => {
    expect(determineDirectionCorrect(15, 8)).toBe(true);
  });

  it("is incorrect when predicted up but actual down", () => {
    expect(determineDirectionCorrect(15, -10)).toBe(false);
  });

  it("treats small moves near zero as flat on both sides -- correct if both are flat", () => {
    expect(determineDirectionCorrect(1, -1)).toBe(true); // both within the flat threshold
  });

  it("is incorrect when predicted flat but actual moved clearly", () => {
    expect(determineDirectionCorrect(0.5, 10)).toBe(false);
  });

  it("is correct when both predicted and actual are clearly down", () => {
    expect(determineDirectionCorrect(-20, -5)).toBe(true);
  });
});

describe("determineRangeOutcome", () => {
  it("classifies as outside when actual price is below the bear price", () => {
    expect(determineRangeOutcome(80, 90, 110, 130)).toBe("outside");
  });

  it("classifies as outside when actual price is above the bull price", () => {
    expect(determineRangeOutcome(150, 90, 110, 130)).toBe("outside");
  });

  it("classifies to the nearest scenario price within range", () => {
    expect(determineRangeOutcome(91, 90, 110, 130)).toBe("bear");
    expect(determineRangeOutcome(109, 90, 110, 130)).toBe("base");
    expect(determineRangeOutcome(129, 90, 110, 130)).toBe("bull");
  });
});

describe("deriveFiveWayRating", () => {
  it("derives strong_bullish for a large expected return with high confidence", () => {
    expect(deriveFiveWayRating(20, 75)).toBe("strong_bullish");
  });

  it("derives bullish (not strong) for a large expected return with lower confidence", () => {
    expect(deriveFiveWayRating(20, 50)).toBe("bullish");
  });

  it("derives neutral for a small expected return", () => {
    expect(deriveFiveWayRating(2, 60)).toBe("neutral");
  });

  it("derives strong_bearish for a large negative expected return with high confidence", () => {
    expect(deriveFiveWayRating(-20, 70)).toBe("strong_bearish");
  });
});

describe("computeEvaluationDueDate", () => {
  it("adds the correct number of months for each horizon", () => {
    const start = new Date("2026-01-15T00:00:00.000Z");
    expect(computeEvaluationDueDate(start, "3_month").getUTCMonth()).toBe(3); // April (0-indexed)
    expect(computeEvaluationDueDate(start, "6_month").getUTCMonth()).toBe(6); // July
    expect(computeEvaluationDueDate(start, "12_month").getUTCFullYear()).toBe(2027);
  });
});

describe("isReadyForEvaluation", () => {
  it("is false before the due date, true on or after it", () => {
    const due = new Date("2026-04-01T00:00:00.000Z");
    expect(isReadyForEvaluation(due, new Date("2026-03-31T00:00:00.000Z"))).toBe(false);
    expect(isReadyForEvaluation(due, new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
    expect(isReadyForEvaluation(due, new Date("2026-05-01T00:00:00.000Z"))).toBe(true);
  });

  it("a 12-month prediction made today is NOT ready after only one month", () => {
    const predictionDate = new Date("2026-01-01T00:00:00.000Z");
    const due = computeEvaluationDueDate(predictionDate, "12_month");
    const oneMonthLater = new Date("2026-02-01T00:00:00.000Z");
    expect(isReadyForEvaluation(due, oneMonthLater)).toBe(false);
  });
});

describe("computeAccuracyByHorizon", () => {
  it("returns null accuracy for a horizon below the minimum sample size", () => {
    const predictions = [evaluatedPrediction({ horizon: "3_month" })];
    const result = computeAccuracyByHorizon(predictions);
    const threeMonth = result.find((h) => h.horizon === "3_month")!;
    expect(threeMonth.evaluatedCount).toBe(1);
    expect(threeMonth.directionAccuracyPct).toBeNull();
  });

  it("computes real accuracy once the minimum sample size is met", () => {
    const predictions = [
      evaluatedPrediction({ horizon: "3_month", directionCorrect: true }),
      evaluatedPrediction({ horizon: "3_month", directionCorrect: true }),
      evaluatedPrediction({ horizon: "3_month", directionCorrect: false }),
    ];
    const result = computeAccuracyByHorizon(predictions);
    const threeMonth = result.find((h) => h.horizon === "3_month")!;
    expect(threeMonth.directionAccuracyPct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("does not count unevaluated (pending) predictions", () => {
    const predictions = [prediction({ horizon: "3_month" })]; // never evaluated
    const result = computeAccuracyByHorizon(predictions);
    const threeMonth = result.find((h) => h.horizon === "3_month")!;
    expect(threeMonth.evaluatedCount).toBe(0);
  });
});

describe("computeRangeAccuracy", () => {
  it("tallies range outcomes across evaluated predictions", () => {
    const predictions = [
      evaluatedPrediction({ rangeOutcome: "bear" }),
      evaluatedPrediction({ rangeOutcome: "base" }),
      evaluatedPrediction({ rangeOutcome: "base" }),
      evaluatedPrediction({ rangeOutcome: "outside" }),
    ];
    const result = computeRangeAccuracy(predictions);
    expect(result).toEqual({ bearCount: 1, baseCount: 2, bullCount: 0, outsideCount: 1, totalEvaluated: 4 });
  });
});

describe("computeRatingPerformance", () => {
  it("computes average actual return per rating bucket", () => {
    const predictions = [
      evaluatedPrediction({ aiRating: "bullish", actualReturnPct: 10 }),
      evaluatedPrediction({ aiRating: "bullish", actualReturnPct: 20 }),
      evaluatedPrediction({ aiRating: "bearish", actualReturnPct: -5 }),
    ];
    const result = computeRatingPerformance(predictions);
    const bullish = result.find((r) => r.rating === "bullish")!;
    const bearish = result.find((r) => r.rating === "bearish")!;
    expect(bullish.averageActualReturnPct).toBeCloseTo(15, 5);
    expect(bearish.averageActualReturnPct).toBeCloseTo(-5, 5);
  });

  it("returns null average for a rating with no evaluated predictions", () => {
    const result = computeRatingPerformance([]);
    expect(result.find((r) => r.rating === "strong_bullish")!.averageActualReturnPct).toBeNull();
  });
});

describe("computeConfidenceCalibration", () => {
  it("returns insufficient_data below the minimum sample size", () => {
    const predictions = Array.from({ length: 5 }, () => evaluatedPrediction());
    const result = computeConfidenceCalibration(predictions);
    expect(result.verdict).toBe("insufficient_data");
  });

  it("identifies overconfidence when stated confidence far exceeds actual accuracy", () => {
    const predictions = [
      ...Array.from({ length: 9 }, () => evaluatedPrediction({ confidenceScore: 90, directionCorrect: false })),
      evaluatedPrediction({ confidenceScore: 90, directionCorrect: true }),
    ]; // 90% avg confidence, 10% actual accuracy
    const result = computeConfidenceCalibration(predictions);
    expect(result.verdict).toBe("overconfident");
  });

  it("identifies reasonable calibration when confidence roughly matches accuracy", () => {
    const predictions = [
      ...Array.from({ length: 6 }, () => evaluatedPrediction({ confidenceScore: 60, directionCorrect: true })),
      ...Array.from({ length: 4 }, () => evaluatedPrediction({ confidenceScore: 60, directionCorrect: false })),
    ]; // 60% avg confidence, 60% actual accuracy
    const result = computeConfidenceCalibration(predictions);
    expect(result.verdict).toBe("reasonably_calibrated");
  });
});

describe("computeSimulatedPerformance", () => {
  it("is clearly labeled as simulated, not real trading results", () => {
    const result = computeSimulatedPerformance([]);
    expect(result.label).toContain("NOT ACTUAL TRADING RESULTS");
  });

  it("computes win/loss counts and largest gain/loss from real actual returns", () => {
    const predictions = [
      evaluatedPrediction({ actualReturnPct: 20 }),
      evaluatedPrediction({ actualReturnPct: -10 }),
      evaluatedPrediction({ actualReturnPct: 5 }),
    ];
    const result = computeSimulatedPerformance(predictions);
    expect(result.winningCount).toBe(2);
    expect(result.losingCount).toBe(1);
    expect(result.largestGainPct).toBe(20);
    expect(result.largestLossPct).toBe(-10);
  });

  it("computes cumulative return via compounding", () => {
    const predictions = [evaluatedPrediction({ actualReturnPct: 10 }), evaluatedPrediction({ actualReturnPct: 10 })];
    const result = computeSimulatedPerformance(predictions);
    // 1.10 * 1.10 = 1.21 -> +21%
    expect(result.cumulativeReturnPct).toBeCloseTo(21, 5);
  });

  it("returns null stats (not zero/NaN) with no evaluated predictions", () => {
    const result = computeSimulatedPerformance([prediction()]); // unevaluated
    expect(result.evaluatedCount).toBe(0);
    expect(result.cumulativeReturnPct).toBeNull();
  });
});

describe("buildAccuracyDashboard", () => {
  it("shows null overall accuracy with an explanatory message below the minimum sample size", () => {
    const predictions = [evaluatedPrediction(), evaluatedPrediction()];
    const result = buildAccuracyDashboard(predictions);
    expect(result.overallDirectionAccuracyPct).toBeNull();
    expect(result.insufficientSampleMessage).toContain("Not enough historical predictions");
  });

  it("shows real overall accuracy once the minimum sample size is met", () => {
    const predictions = [
      ...Array.from({ length: 4 }, () => evaluatedPrediction({ directionCorrect: true })),
      evaluatedPrediction({ directionCorrect: false }),
    ];
    const result = buildAccuracyDashboard(predictions);
    expect(result.overallDirectionAccuracyPct).toBeCloseTo(80, 5);
    expect(result.insufficientSampleMessage).toBeNull();
  });

  it("correctly separates pending from evaluated predictions", () => {
    const predictions = [evaluatedPrediction(), prediction(), prediction()];
    const result = buildAccuracyDashboard(predictions);
    expect(result.totalPredictions).toBe(3);
    expect(result.evaluatedPredictions).toBe(1);
    expect(result.pendingPredictions).toBe(2);
  });
});
