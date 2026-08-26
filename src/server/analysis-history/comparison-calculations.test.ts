import { describe, expect, it } from "vitest";
import { computeComparisonDeltas } from "./comparison-calculations";
import type { SavedAnalysisRecord } from "@/lib/analysis-history-types";

function analysis(overrides: Partial<SavedAnalysisRecord> = {}): SavedAnalysisRecord {
  return {
    id: "a1",
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    analysisDate: "2026-01-01T00:00:00.000Z",
    priceAtAnalysis: 150,
    rating: "buy",
    confidenceScore: 78,
    bearPrice: 130,
    basePrice: 180,
    bullPrice: 220,
    expectedPrice: 180,
    expectedReturnPct: 20,
    bearProbabilityPct: 20,
    baseProbabilityPct: 50,
    bullProbabilityPct: 30,
    valuationConclusion: "x",
    sentimentConclusion: "x",
    macroConclusion: "x",
    competitorConclusion: "x",
    managementConclusion: "x",
    committeeConclusion: "x",
    devilsAdvocateConclusion: "x",
    bottomLine: "x",
    majorAssumptions: [],
    majorRisks: [],
    majorCatalysts: [],
    keyNewsFindings: [],
    ...overrides,
  };
}

describe("computeComparisonDeltas", () => {
  it("computes price change percentage exactly", () => {
    const previous = analysis({ priceAtAnalysis: 150 });
    const current = analysis({ priceAtAnalysis: 165, analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.priceChangePct).toBeCloseTo(10, 5);
  });

  it("computes expected price change percentage exactly", () => {
    const previous = analysis({ expectedPrice: 180 });
    const current = analysis({ expectedPrice: 195, analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.expectedPriceChangePct).toBeCloseTo((15 / 180) * 100, 5);
  });

  it("computes confidence change as a percentage-point difference, not a percent-of-percent", () => {
    const previous = analysis({ confidenceScore: 78 });
    const current = analysis({ confidenceScore: 71, analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.confidenceChangePts).toBe(-7); // NOT (71-78)/78*100
  });

  it("detects when the rating changed", () => {
    const previous = analysis({ rating: "buy" });
    const current = analysis({ rating: "hold", analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.ratingChanged).toBe(true);
  });

  it("detects when the rating did NOT change", () => {
    const previous = analysis({ rating: "buy" });
    const current = analysis({ rating: "buy", analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.ratingChanged).toBe(false);
  });

  it("computes the number of days between analyses correctly", () => {
    const previous = analysis({ analysisDate: "2026-01-01T00:00:00.000Z" });
    const current = analysis({ analysisDate: "2026-03-01T00:00:00.000Z" }); // 59 days in a non-leap-ish window
    const result = computeComparisonDeltas(previous, current);
    expect(result.daysBetweenAnalyses).toBe(59);
  });

  it("returns 0 percent change (not NaN/Infinity) when the previous value was zero", () => {
    const previous = analysis({ priceAtAnalysis: 0 });
    const current = analysis({ priceAtAnalysis: 10, analysisDate: "2026-03-01T00:00:00.000Z" });
    const result = computeComparisonDeltas(previous, current);
    expect(result.priceChangePct).toBe(0);
  });
});
