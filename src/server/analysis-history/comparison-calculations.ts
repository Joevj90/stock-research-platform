import type { ComparisonDeltas, SavedAnalysisRecord } from "@/lib/analysis-history-types";

/**
 * Deterministic comparison arithmetic -- pure math over two real saved
 * analyses. No AI involvement. "Do NOT change the rating simply because
 * the stock price changed" is enforced structurally here: this module
 * only ever REPORTS deltas, it never decides whether they justify a
 * rating change -- that judgment belongs to the AI interpreter, working
 * from these real numbers.
 */
export function computeComparisonDeltas(previous: SavedAnalysisRecord, current: SavedAnalysisRecord): ComparisonDeltas {
  const priceChangePct = pctChange(current.priceAtAnalysis, previous.priceAtAnalysis);
  const expectedPriceChangePct = pctChange(current.expectedPrice, previous.expectedPrice);
  const confidenceChangePts = current.confidenceScore - previous.confidenceScore;
  const expectedReturnChangePts = current.expectedReturnPct - previous.expectedReturnPct;
  const ratingChanged = current.rating !== previous.rating;
  const daysBetweenAnalyses = Math.round(
    (new Date(current.analysisDate).getTime() - new Date(previous.analysisDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    priceChangePct,
    expectedPriceChangePct,
    confidenceChangePts,
    expectedReturnChangePts,
    ratingChanged,
    daysBetweenAnalyses,
  };
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}
