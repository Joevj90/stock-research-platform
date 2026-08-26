import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisHistoryResult, ComparisonResult, SavedAnalysisRecord, SavedAnalysisWithReport } from "@/lib/analysis-history-types";
import type { FinalReportResult } from "@/lib/final-report-types";
import { rowToRecord } from "./save-service";
import { computeComparisonDeltas } from "./comparison-calculations";
import { interpretComparison } from "./comparison-interpreter";

const log = logger.child("analysis-history:service");

/**
 * Returns every saved analysis for a ticker (newest first) plus a
 * comparison between the two most recent, if at least two exist. This
 * makes NO new AI call by default when there's nothing to compare (0 or
 * 1 saved analyses) -- "this feature should NOT continuously consume AI
 * tokens... only retrieve current information when the user explicitly
 * clicks Research Again." Viewing history is always free; only
 * generating a NEW analysis (via the existing Final Report flow) or
 * requesting a fresh comparison costs anything.
 */
export async function getAnalysisHistory(rawTicker: string): Promise<Result<AnalysisHistoryResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const rows = await prisma.savedAnalysis.findMany({
    where: { ticker },
    orderBy: { analysisDate: "desc" },
  });

  const analyses = rows.map(rowToRecord);

  let latestComparison: ComparisonResult | null = null;
  if (analyses.length >= 2) {
    const comparisonResult = await getComparison(analyses[0]!, analyses[1]!);
    if (comparisonResult.ok) latestComparison = comparisonResult.data;
    // If the comparison AI call fails, history is still shown -- the
    // comparison is supplementary, not a reason to hide real saved data.
  }

  return { ok: true, data: { ticker, analyses, latestComparison } };
}

/**
 * Compares two specific saved analyses (by ID) -- used when the user
 * wants to compare two versions other than "the two most recent" (e.g.
 * an older pair from the history table).
 */
export async function compareTwoAnalyses(currentId: string, previousId: string): Promise<Result<ComparisonResult>> {
  const [currentRow, previousRow] = await Promise.all([
    prisma.savedAnalysis.findUnique({ where: { id: currentId } }),
    prisma.savedAnalysis.findUnique({ where: { id: previousId } }),
  ]);

  if (!currentRow || !previousRow) {
    return { ok: false, error: { code: "INVALID_TICKER", message: "One or both analyses could not be found." } };
  }

  return getComparison(rowToRecord(currentRow), rowToRecord(previousRow));
}

async function getComparison(current: SavedAnalysisRecord, previous: SavedAnalysisRecord): Promise<Result<ComparisonResult>> {
  const deltas = computeComparisonDeltas(previous, current);

  const narrativeResult = await interpretComparison({
    ticker: current.ticker,
    companyName: current.companyName,
    previous,
    current,
    deltas,
  });

  if (!narrativeResult.ok) {
    log.warn("comparison deltas computed but narrative interpretation failed", {
      ticker: current.ticker,
      error: narrativeResult.error,
    });
    return narrativeResult;
  }

  return {
    ok: true,
    data: {
      previous,
      current,
      deltas,
      ...narrativeResult.data,
    },
  };
}

/** Fetches one saved analysis's FULL verbatim historical report --
 * "view the full report that existed at that time." */
export async function getSavedAnalysisReport(id: string): Promise<Result<SavedAnalysisWithReport>> {
  const row = await prisma.savedAnalysis.findUnique({ where: { id } });
  if (!row) {
    return { ok: false, error: { code: "INVALID_TICKER", message: "This saved analysis could not be found." } };
  }

  return {
    ok: true,
    data: { ...rowToRecord(row), fullReport: JSON.parse(row.fullReportJson) as FinalReportResult },
  };
}
