import { runDevilsAdvocate } from "@/server/agents/devils-advocate";
import { gatherAnalysisSummaries, type GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import { runForecast } from "@/server/agents/forecasting";
import { runInvestmentCommittee } from "@/server/agents/investment-committee";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";
import type { DataConsistencyNote, FinalReportResult } from "@/lib/final-report-types";
import { bucketGrowthPct, bucketMarginPct, bucketRiskScore0To100, bucketScoreNeg100To100 } from "./labels";

const log = logger.child("agents:final-report");

/**
 * The Final AI Investment Report -- the single-request convenience
 * wrapper. This chains gather -> Forecast+Committee (parallel) ->
 * Devil's Advocate -> assembly, all in one call, exactly as Steps 1-17
 * always have. Kept for completeness/tests and any future direct
 * server-side usage, but the live UI (`FinalReportPanel`) now drives the
 * SAME pieces through separate, shorter-lived API routes (see
 * `/api/final-report/[ticker]/gather`, `/forecast`, `/committee`,
 * `/devils-advocate`, `/assemble`) -- this app's deepest chain
 * (gather -> Forecast/Committee -> Devil's Advocate) can, in the worst
 * case, exceed even Vercel Pro's 300-second function limit when run as
 * one request; splitting it into several short requests the client
 * orchestrates sequentially means each individual step comfortably fits
 * within the limit even though the whole process still takes a few
 * minutes end to end. Every step below calls the exact same real
 * functions this one-shot version does -- no duplicated logic, just a
 * different caller.
 */
export async function runFinalReport(rawTicker: string): Promise<Result<FinalReportResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const gathered = await gatherAnalysisSummaries(ticker);
  if (gathered.currentPrice === null) {
    return {
      ok: false,
      error: { code: "INVALID_TICKER", message: `Could not find price data for "${ticker}".` },
    };
  }

  const [forecastResult, committeeResult] = await Promise.all([
    runForecast(ticker, gathered),
    runInvestmentCommittee(ticker, gathered),
  ]);

  if (!forecastResult.ok) return forecastResult;
  if (!committeeResult.ok) return committeeResult;

  const devilsAdvocateResult = await runDevilsAdvocate(ticker, { gathered, forecastResult, committeeResult });
  if (!devilsAdvocateResult.ok) {
    log.warn("final report could not obtain a devil's advocate review", { ticker, error: devilsAdvocateResult.error });
    return devilsAdvocateResult;
  }

  return assembleFinalReport(ticker, gathered, forecastResult.data, committeeResult.data, devilsAdvocateResult.data);
}

/**
 * The PURE ASSEMBLY step -- "do not independently calculate new
 * financial metrics unless necessary" and "must use existing outputs"
 * followed literally: this makes NO AI call and NO network call at all.
 * Every section is either copied directly from an already-computed real
 * result, or a deterministic label bucketed from a real score
 * (`labels.ts`) -- formatting, not new judgment. This is fast enough
 * (well under a second) to run as its own final API step in the
 * multi-step flow, taking the already-fetched results of the previous
 * four steps as plain input.
 */
export function assembleFinalReport(
  ticker: string,
  gathered: GatheredAnalysisInputs,
  forecast: ForecastResult,
  committeeResult: CommitteeResult,
  da: DevilsAdvocateResult
): Result<FinalReportResult> {
  const committee = committeeResult.interpretation;
  const { full, companyName } = gathered;
  const currentPrice = gathered.currentPrice;
  if (currentPrice === null) {
    return { ok: false, error: { code: "INVALID_TICKER", message: `Could not find price data for "${ticker}".` } };
  }

  const twelveMonth = forecast.interpretation.horizons.find((h) => h.horizon === "12_month");
  if (!twelveMonth) {
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Forecast did not include a 12-month horizon." } };
  }

  // Reflect the Devil's Advocate's revision if one genuinely happened --
  // otherwise the report should show the Committee's original conclusion.
  // The rating and the confidence score are revised independently: a
  // critique can justify adjusting confidence (e.g. the Committee's
  // number looked overstated relative to a near-tied vote) without being
  // strong enough to flip the buy/hold/sell rating itself -- so
  // finalConfidence must check wasConfidenceRevised too, not just
  // wasThesisRevised, or a legitimate confidence-only critique would
  // silently be dropped.
  const finalRating = da.committeeReview.wasThesisRevised
    ? da.committeeReview.revisedRating!
    : committee.finalRecommendation;
  const finalConfidence =
    da.committeeReview.wasThesisRevised || da.committeeReview.wasConfidenceRevised
      ? da.committeeReview.revisedConfidence!
      : committee.finalConfidence;

  const news = full.news;
  const topEvents = (news?.interpretation.importantEvents ?? []).slice(0, 5).map((event) => {
    const article = news?.articles.find((a) => a.url === event.primaryArticleUrl);
    return {
      headline: article?.headline ?? "Source article",
      url: event.primaryArticleUrl,
      source: article?.source ?? "Unknown source",
      whatHappened: event.whatHappened,
      whyItMatters: event.whyItMatters,
    };
  });

  const latestRevenueGrowth = full.fundamental?.calculated.revenueGrowthPct.at(-1) ?? null;
  const latestNetMargin = full.fundamental?.calculated.netMarginPct.at(-1) ?? null;

  // whyAiLikesIt / whyAiIsWorried: reuse the Committee's real agreement
  // and disagreement lists; if disagreements alone don't reach 3 items,
  // supplement with Devil's Advocate's real weaknesses -- never invented.
  const whyAiIsWorried = [
    ...committee.keyDisagreements.map((d) => `${d.topic}: ${d.description}`),
    ...da.interpretation.majorWeaknesses.map((w) => `${w.problem}: ${w.whyItMatters}`),
  ].slice(0, 5);

  const dataConsistencyNotes = buildDataConsistencyNotes(
    full.valuation?.interpretation.rating ?? null,
    twelveMonth.expectedReturnPct
  );

  const sources = topEvents.map((e) => ({ label: e.headline, url: e.url }));

  const bottomLine = [committee.overallConclusion, da.interpretation.whatAssumptionWorriesMost ? `The biggest uncertainty: ${da.interpretation.whatAssumptionWorriesMost}` : null]
    .filter((s): s is string => Boolean(s))
    .join(" ");

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),

      quickAnswer: {
        rating: finalRating,
        currentPrice,
        expectedPrice: twelveMonth.expectedPrice,
        expectedReturnPct: twelveMonth.expectedReturnPct,
        expectedReturnHorizon: "12_month",
        confidenceScore: finalConfidence,
        explanation: committee.overallConclusion,
      },

      whyAiLikesIt: committee.keyAgreements.slice(0, 5),
      whyAiIsWorried,

      bearBaseBull: {
        bear: twelveMonth.bear,
        base: twelveMonth.base,
        bull: twelveMonth.bull,
        expectedPrice: twelveMonth.expectedPrice,
        expectedReturnPct: twelveMonth.expectedReturnPct,
      },

      // All three horizons the Forecasting Agent already computed
      // (Step 14) -- reused verbatim, nothing recalculated here -- so the
      // report can show 3/6/12-month expected returns instead of only
      // the 12-month figure used above.
      forecastHorizons: forecast.interpretation.horizons.map((h) => ({
        horizon: h.horizon,
        expectedPrice: h.expectedPrice,
        expectedReturnPct: h.expectedReturnPct,
      })),

      businessQuality: {
        financialHealth: bucketScoreNeg100To100(full.fundamental?.interpretation.overallFundamentalScore ?? null),
        growth: bucketGrowthPct(latestRevenueGrowth),
        profitability: bucketMarginPct(latestNetMargin),
        competitivePosition: bucketScoreNeg100To100(full.competitor?.interpretation.competitiveScore ?? null),
        management: bucketScoreNeg100To100(full.management?.interpretation.managementScore ?? null),
        businessRisks: bucketRiskScore0To100(full.risk?.interpretation.riskScore ?? null),
        explanation: full.fundamental?.interpretation.overallConclusion ?? "Financial data unavailable for this company.",
      },

      valuation: {
        rating: full.valuation?.interpretation.rating ?? "reasonably_priced",
        explanation: full.valuation?.interpretation.explanation ?? "Valuation data unavailable for this company.",
      },

      whatsHappeningNow: {
        summary: news?.interpretation.whatsHappening ?? { positive: [], negative: [], neutral: [] },
        topEvents,
      },

      marketSentiment: {
        direction: full.sentiment?.interpretation.sentimentDirection ?? "neutral",
        trend: full.sentiment?.interpretation.sentimentTrend ?? "stable",
        whatInvestorsLike: full.sentiment?.interpretation.positiveFactors.slice(0, 4) ?? [],
        whatInvestorsAreWorriedAbout: full.sentiment?.interpretation.negativeFactors.slice(0, 4) ?? [],
      },

      economy: {
        environment: full.macro?.interpretation.overallMacroEnvironment ?? "neutral",
        explanation: full.macro?.interpretation.overallConclusion ?? "Economic data unavailable for this company.",
      },

      competition: {
        isWinning: full.competitor?.interpretation.whoIsWinning ?? "Competitive data unavailable for this company.",
        majorCompetitors:
          full.competitor?.interpretation.competitorSelections.map((c) => c.companyName ?? c.ticker) ?? [],
      },

      management: {
        assessment: full.management?.interpretation.overallAssessment ?? "neutral",
        credibilityExplanation:
          full.management?.interpretation.managementCredibilityExplanation ?? "Management data unavailable.",
        capitalAllocationAssessment:
          full.management?.interpretation.capitalAllocationAssessment ?? "Management data unavailable.",
        concerns: full.management?.interpretation.managementConcerns.map((c) => c.explanation).slice(0, 3) ?? [],
      },

      biggestRisks: full.risk?.interpretation.biggestRisks.slice(0, 3) ?? [],

      devilsAdvocate: {
        whatCouldWeBeMissing: da.interpretation.overlookedRisks.slice(0, 5),
        strongestArgumentAgainst: da.interpretation.finalConclusion,
        // Either kind of revision (rating or confidence-only) counts as
        // "changed something" here -- see the finalConfidence comment
        // above for why confidence-only revisions matter too.
        didItChangeAnything: da.committeeReview.wasThesisRevised || da.committeeReview.wasConfidenceRevised,
        whatChanged: da.committeeReview.whatChangedAndWhy,
      },

      whatWouldChangeAiMind: {
        moreBearishIf: full.risk?.interpretation.whatWouldMakeMoreBearish ?? [],
        lessWorriedIf: full.risk?.interpretation.whatWouldMakeLessWorried ?? [],
      },

      finalConclusion: {
        bottomLine,
        rating: finalRating,
        confidenceScore: finalConfidence,
        expectedReturnPct: twelveMonth.expectedReturnPct,
        expectedReturnHorizon: "12_month",
      },

      dataConsistencyNotes,
      sources,
    },
  };
}

/**
 * A small, real, checkable cross-agent tension: if the Valuation Engine
 * says the stock looks expensive/very expensive but the Forecasting
 * Agent's expected return is strongly positive (or vice versa for
 * cheap/negative), that's worth surfacing rather than silently picking
 * one number -- "identify the conflict... explain the discrepancy when
 * important."
 */
function buildDataConsistencyNotes(
  valuationRating: string | null,
  expectedReturnPct: number
): DataConsistencyNote[] {
  const notes: DataConsistencyNote[] = [];

  if ((valuationRating === "expensive" || valuationRating === "very_expensive") && expectedReturnPct > 15) {
    notes.push({
      topic: "Valuation vs. forecast",
      description:
        "The Valuation Engine rates this stock as expensive, but the Forecasting Agent's expected return is " +
        "still strongly positive. This means the forecast is betting on continued strong growth to justify " +
        "today's price -- if that growth doesn't materialize, the valuation concern becomes more important.",
    });
  }

  if (valuationRating === "cheap" && expectedReturnPct < 0) {
    notes.push({
      topic: "Valuation vs. forecast",
      description:
        "The Valuation Engine rates this stock as cheap, but the Forecasting Agent's expected return is " +
        "negative. This suggests the forecast sees company-specific or market risks serious enough to " +
        "outweigh the attractive price.",
    });
  }

  return notes;
}
