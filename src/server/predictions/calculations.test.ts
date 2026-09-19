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

/** Each fixture lands in a different week, so tests that need a verdict
 * aren't blocked by the separate-weeks requirement unless they set dates
 * themselves. */
let fixtureWeek = 0;
function nextWeekDate(): string {
  fixtureWeek++;
  return new Date(Date.UTC(2026, 0, 5 + fixtureWeek * 7)).toISOString();
}

/** Correctness is expressed through the returns, since that is what the
 * scoring reads: the default call is +12% (up), so "wrong" means the
 * stock fell. Passing `directionCorrect: false` flips the actual return
 * unless the test sets one explicitly. */
function evaluatedPrediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  const wrong = overrides.directionCorrect === false && overrides.actualReturnPct === undefined;
  return prediction({
    predictionDate: nextWeekDate(),
    actualPrice: 108,
    evaluatedAt: "2026-04-01T00:00:00.000Z",
    actualReturnPct: wrong ? -8 : 8,
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
    expect(computeEvaluationDueDate(start, "1_month").getUTCMonth()).toBe(1); // February
    expect(computeEvaluationDueDate(start, "3_month").getUTCMonth()).toBe(3); // April (0-indexed)
    expect(computeEvaluationDueDate(start, "6_month").getUTCMonth()).toBe(6); // July
    expect(computeEvaluationDueDate(start, "12_month").getUTCFullYear()).toBe(2027);
  });

  it("adds exactly 7 days for the 1-week horizon", () => {
    const start = new Date("2026-01-15T00:00:00.000Z");
    const due = computeEvaluationDueDate(start, "1_week");
    expect(due.getUTCDate()).toBe(22);
    expect(due.getUTCMonth()).toBe(0); // still January
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

describe("computeAccuracyByHorizon — baseline comparison", () => {
  /** A resolved prediction: `up` is what the market actually did,
   * `correct` is whether the AI called that direction. */
  function resolved(up: boolean, correct: boolean) {
    const calledUp = correct ? up : !up;
    return prediction({
      horizon: "1_week",
      predictionDate: nextWeekDate(),
      evaluatedAt: new Date().toISOString(),
      directionCorrect: correct,
      expectedReturnPct: calledUp ? 3 : -3,
      actualReturnPct: up ? 4 : -4,
    });
  }

  it("sets the baseline to the dominant market direction, not 50%", () => {
    // 8 of 10 rose, so always guessing up scores 80%.
    const records = [
      ...Array.from({ length: 8 }, () => resolved(true, true)),
      ...Array.from({ length: 2 }, () => resolved(false, true)),
    ];
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(oneWeek!.baselineAccuracyPct).toBeCloseTo(80, 5);
  });

  it("reports zero edge when the AI merely matches the market's drift", () => {
    // Market rose 7 of 10; AI also right 7 of 10. It added nothing.
    const records = [
      ...Array.from({ length: 7 }, () => resolved(true, true)),
      ...Array.from({ length: 3 }, () => resolved(false, false)),
    ];
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(oneWeek!.directionAccuracyPct).toBeCloseTo(70, 5);
    expect(oneWeek!.edgePct).toBeCloseTo(0, 5);
  });

  it("reports negative edge when the AI does worse than guessing the drift", () => {
    // Market rose 9 of 10 (baseline 90%), AI right only 5 of 10.
    const records = [
      ...Array.from({ length: 5 }, () => resolved(true, true)),
      ...Array.from({ length: 4 }, () => resolved(true, false)),
      resolved(false, false),
    ];
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(oneWeek!.edgePct!).toBeLessThan(0);
  });

  it("refuses an edge verdict below 30 resolved predictions, however large the edge", () => {
    const records = Array.from({ length: 10 }, (_, i) => resolved(i % 2 === 0, true));
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(oneWeek!.evaluatedCount).toBe(10);
    expect(oneWeek!.isEdgeMeaningful).toBe(false);
  });

  it("declares a meaningful edge once the sample is large and the edge clears noise", () => {
    // 50 predictions, market split evenly (baseline 50%), AI right 45.
    const records = [
      ...Array.from({ length: 25 }, (_, i) => resolved(true, i < 23)),
      ...Array.from({ length: 25 }, (_, i) => resolved(false, i < 22)),
    ];
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(oneWeek!.evaluatedCount).toBe(50);
    expect(oneWeek!.isEdgeMeaningful).toBe(true);
    expect(oneWeek!.edgePct!).toBeGreaterThan(0);
  });

  it("leaves baseline and edge null when nothing has resolved yet", () => {
    const [oneWeek] = computeAccuracyByHorizon([], ["1_week"]);
    expect(oneWeek!.evaluatedCount).toBe(0);
    expect(oneWeek!.baselineAccuracyPct).toBeNull();
    expect(oneWeek!.edgePct).toBeNull();
    expect(oneWeek!.isEdgeMeaningful).toBe(false);
  });

  it("ignores zero-return predictions when computing the market's drift", () => {
    const records = [
      ...Array.from({ length: 6 }, () => resolved(true, true)),
      prediction({
        horizon: "1_week",
        evaluatedAt: new Date().toISOString(),
        directionCorrect: true,
        actualReturnPct: 0,
      }),
    ];
    const [oneWeek] = computeAccuracyByHorizon(records, ["1_week"]);
    // All six directional outcomes rose, so the baseline is 100%.
    expect(oneWeek!.baselineAccuracyPct).toBeCloseTo(100, 5);
  });
});

describe("scoring fairness — AI and baseline graded by the same rule", () => {
  function weekly(
    expectedReturnPct: number,
    actualReturnPct: number,
    date = "2026-09-08T14:00:00.000Z"
  ): PredictionRecord {
    return prediction({
      horizon: "1_week",
      predictionDate: date,
      evaluatedAt: "2026-09-15T14:00:00.000Z",
      expectedReturnPct,
      actualReturnPct,
      directionCorrect: false, // the old three-outcome flag; scoring must ignore it
    });
  }

  it("counts a small bearish call as correct when the stock falls a lot", () => {
    // The exact case that broke the old scoring: AI predicts -0.9% ("flat"
    // under the old rule), stock falls 4%. It called the direction.
    const [week] = computeAccuracyByHorizon(
      Array.from({ length: 5 }, () => weekly(-0.9, -4)),
      ["1_week"]
    );
    expect(week!.directionAccuracyPct).toBeCloseTo(100, 5);
    expect(week!.edgePct).toBeCloseTo(0, 5); // matched the market, added nothing
  });

  it("ignores the stored three-outcome flag entirely", () => {
    const [week] = computeAccuracyByHorizon(
      Array.from({ length: 4 }, () => weekly(3, 5)),
      ["1_week"]
    );
    expect(week!.correctCount).toBe(4);
  });

  it("excludes calls with no direction from accuracy and baseline alike", () => {
    const [week] = computeAccuracyByHorizon(
      [weekly(0, 5), weekly(2, 0), weekly(2, 3), weekly(2, 3), weekly(-2, 3)],
      ["1_week"]
    );
    expect(week!.evaluatedCount).toBe(3);
  });

  it("measures small-move calls separately from direction", () => {
    const [week] = computeAccuracyByHorizon(
      [weekly(-0.9, -4), weekly(0.5, 1), weekly(1.5, -1.8), weekly(8, 9)],
      ["1_week"]
    );
    expect(week!.flatCallCount).toBe(3); // the 8% call isn't a flat call
    expect(week!.flatCallStayedFlatPct).toBeCloseTo((2 / 3) * 100, 5);
  });
});

describe("separate-weeks requirement", () => {
  it("refuses a verdict when every prediction comes from the same week, however many there are", () => {
    // 40 predictions, AI right on all of them, market split -- a huge
    // edge, but all from one week, so one market move could explain it.
    const records = Array.from({ length: 40 }, (_, i) =>
      prediction({
        horizon: "1_week",
        predictionDate: "2026-09-08T14:00:00.000Z",
        evaluatedAt: "2026-09-15T14:00:00.000Z",
        expectedReturnPct: i % 2 === 0 ? 3 : -3,
        actualReturnPct: i % 2 === 0 ? 4 : -4,
      })
    );
    const [week] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(week!.distinctWeeks).toBe(1);
    expect(week!.isEdgeMeaningful).toBe(false);
  });

  it("counts predictions made on different days of the same week as one week", () => {
    const days = ["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-13"]; // Mon-Sun
    const records = days.map((d) =>
      prediction({
        horizon: "1_week",
        predictionDate: `${d}T14:00:00.000Z`,
        evaluatedAt: "2026-09-20T14:00:00.000Z",
        expectedReturnPct: 3,
        actualReturnPct: 4,
      })
    );
    const [week] = computeAccuracyByHorizon(records, ["1_week"]);
    expect(week!.distinctWeeks).toBe(1);
  });

  it("withholds the confidence verdict until predictions span enough weeks", () => {
    const records = Array.from({ length: 12 }, () =>
      prediction({
        predictionDate: "2026-09-08T14:00:00.000Z",
        evaluatedAt: "2026-09-15T14:00:00.000Z",
        confidenceScore: 90,
        expectedReturnPct: 3,
        actualReturnPct: -4,
      })
    );
    expect(computeConfidenceCalibration(records).verdict).toBe("insufficient_data");
  });
});

describe("computeSimulatedPerformance — follows each call", () => {
  it("counts a correct bearish call as a win", () => {
    const result = computeSimulatedPerformance([
      evaluatedPrediction({ expectedReturnPct: -2, actualReturnPct: -4 }),
    ]);
    expect(result.winningCount).toBe(1);
    expect(result.averageReturnPct).toBeCloseTo(4, 5);
  });

  it("counts a wrong bearish call as a loss", () => {
    const result = computeSimulatedPerformance([
      evaluatedPrediction({ expectedReturnPct: -2, actualReturnPct: 5 }),
    ]);
    expect(result.losingCount).toBe(1);
    expect(result.averageReturnPct).toBeCloseTo(-5, 5);
  });
});
