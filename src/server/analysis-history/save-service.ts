import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { FinalReportResult } from "@/lib/final-report-types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { SavedAnalysisRecord } from "@/lib/analysis-history-types";

const log = logger.child("analysis-history:save");

/**
 * Permanently saves a completed Final Report as a new, immutable
 * historical version -- "every completed analysis must be saved as a
 * separate historical version... never modify Analysis #1 after
 * Analysis #2 is created." This function only ever CREATEs a new row;
 * nothing in this module ever updates an existing SavedAnalysis.
 *
 * Called automatically from the Final Report assembly step (Step 17's
 * `/api/final-report/[ticker]/assemble` route) every time a report
 * finishes -- "Research Again" is simply running that same existing
 * flow again, so saving happens for free, without any new user-facing
 * step.
 *
 * @param forecast The same ForecastResult already available at the
 * assemble step -- used only to pull `majorAssumptions`/`majorCatalysts`,
 * since the distilled FinalReportResult doesn't carry those lists
 * itself (it summarizes Forecast's 12-month scenario data but not its
 * assumptions/catalysts). Never re-fetched, never re-derived.
 */
export async function saveAnalysis(
  ticker: string,
  report: FinalReportResult,
  forecast: ForecastResult
): Promise<Result<SavedAnalysisRecord>> {
  try {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker },
    });

    const row = await prisma.savedAnalysis.create({
      data: {
        stockId: stock.id,
        ticker,
        companyName: report.companyName,

        priceAtAnalysis: report.quickAnswer.currentPrice,
        rating: report.quickAnswer.rating,
        confidenceScore: report.quickAnswer.confidenceScore,
        bearPrice: report.bearBaseBull.bear.priceTarget,
        basePrice: report.bearBaseBull.base.priceTarget,
        bullPrice: report.bearBaseBull.bull.priceTarget,
        expectedPrice: report.bearBaseBull.expectedPrice,
        expectedReturnPct: report.bearBaseBull.expectedReturnPct,
        bearProbabilityPct: report.bearBaseBull.bear.probabilityPct,
        baseProbabilityPct: report.bearBaseBull.base.probabilityPct,
        bullProbabilityPct: report.bearBaseBull.bull.probabilityPct,

        valuationConclusion: report.valuation.explanation,
        sentimentConclusion: `Sentiment is ${report.marketSentiment.direction}, trending ${report.marketSentiment.trend}.`,
        macroConclusion: report.economy.explanation,
        competitorConclusion: report.competition.isWinning,
        managementConclusion: `${report.management.capitalAllocationAssessment} ${report.management.credibilityExplanation}`,
        committeeConclusion: report.quickAnswer.explanation,
        devilsAdvocateConclusion: report.devilsAdvocate.strongestArgumentAgainst,
        bottomLine: report.finalConclusion.bottomLine,

        majorAssumptions: JSON.stringify(forecast.interpretation.assumptions.map((a) => a.assumption)),
        majorRisks: JSON.stringify(report.biggestRisks.map((r) => r.risk)),
        majorCatalysts: JSON.stringify(forecast.interpretation.keyCatalysts.map((c) => c.whatCouldHappen)),
        keyNewsFindings: JSON.stringify(
          report.whatsHappeningNow.topEvents.map((e) => ({
            headline: e.headline,
            url: e.url,
            source: e.source,
            whatHappened: e.whatHappened,
          }))
        ),

        fullReportJson: JSON.stringify(report),
      },
    });

    log.info("saved new analysis history version", { ticker, id: row.id });
    return { ok: true, data: rowToRecord(row) };
  } catch (err) {
    log.error("failed to save analysis history", { ticker, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to save this analysis to history." } };
  }
}

interface SavedAnalysisRow {
  id: string;
  ticker: string;
  companyName: string | null;
  analysisDate: Date;
  priceAtAnalysis: number;
  rating: string;
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
  majorAssumptions: string;
  majorRisks: string;
  majorCatalysts: string;
  keyNewsFindings: string;
}

export function rowToRecord(row: SavedAnalysisRow): SavedAnalysisRecord {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.companyName,
    analysisDate: row.analysisDate.toISOString(),
    priceAtAnalysis: row.priceAtAnalysis,
    rating: row.rating as SavedAnalysisRecord["rating"],
    confidenceScore: row.confidenceScore,
    bearPrice: row.bearPrice,
    basePrice: row.basePrice,
    bullPrice: row.bullPrice,
    expectedPrice: row.expectedPrice,
    expectedReturnPct: row.expectedReturnPct,
    bearProbabilityPct: row.bearProbabilityPct,
    baseProbabilityPct: row.baseProbabilityPct,
    bullProbabilityPct: row.bullProbabilityPct,
    valuationConclusion: row.valuationConclusion,
    sentimentConclusion: row.sentimentConclusion,
    macroConclusion: row.macroConclusion,
    competitorConclusion: row.competitorConclusion,
    managementConclusion: row.managementConclusion,
    committeeConclusion: row.committeeConclusion,
    devilsAdvocateConclusion: row.devilsAdvocateConclusion,
    bottomLine: row.bottomLine,
    majorAssumptions: JSON.parse(row.majorAssumptions),
    majorRisks: JSON.parse(row.majorRisks),
    majorCatalysts: JSON.parse(row.majorCatalysts),
    keyNewsFindings: JSON.parse(row.keyNewsFindings),
  };
}
