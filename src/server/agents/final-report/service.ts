import { runDevilsAdvocate } from "@/server/agents/devils-advocate";
import { gatherAnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import { runForecast } from "@/server/agents/forecasting";
import { runInvestmentCommittee } from "@/server/agents/investment-committee";
import { runNewsIntelligence } from "@/server/agents/news-intelligence";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsIntelligenceResult } from "@/lib/news-types";
import type { DataConsistencyNote, FinalReportResult } from "@/lib/final-report-types";
import { bucketGrowthPct, bucketMarginPct, bucketRiskScore0To100, bucketScoreNeg100To100 } from "./labels";

const log = logger.child("agents:final-report");

/**
 * The Final AI Investment Report.
 *
 * This is deliberately a PRESENTATION layer, not another analysis layer
 * -- "do not independently calculate new financial metrics unless
 * necessary" and "must use existing outputs" are followed literally:
 * this service makes NO new AI call of its own. Every section is either
 * copied directly from an existing agent's real output, or a
 * deterministic label bucketed from a real score (`labels.ts`) --
 * formatting, not new judgment.
 *
 * Zero added AI-call cost beyond Devil's Advocate's own chain: this
 * service gathers the 8-agent evidence exactly once and feeds it into
 * `runForecast`, `runInvestmentCommittee`, and `runDevilsAdvocate` via
 * their `precomputed`/`precomputedGathered` parameters (all added
 * specifically to support this step, each verified against its own
 * existing test suite first). The one genuinely new call is
 * `runNewsIntelligence` -- section 7 needs real, sourced article URLs
 * that the shared gatherer's compact summaries never included, since
 * Forecast/Committee/Devil's Advocate never needed that level of detail.
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

  const [forecastResult, committeeResult, newsResult] = await Promise.all([
    runForecast(ticker, gathered),
    runInvestmentCommittee(ticker, gathered),
    runNewsIntelligence(ticker),
  ]);

  // Sections 4 and 14 fundamentally require a real forecast; section 1's
  // rating fundamentally requires a real committee conclusion. Without
  // both, this report can't honestly claim to be "the final report."
  if (!forecastResult.ok) return forecastResult;
  if (!committeeResult.ok) return committeeResult;

  const devilsAdvocateResult = await runDevilsAdvocate(ticker, { gathered, forecastResult, committeeResult });
  if (!devilsAdvocateResult.ok) {
    log.warn("final report could not obtain a devil's advocate review", { ticker, error: devilsAdvocateResult.error });
    return devilsAdvocateResult;
  }

  const forecast = forecastResult.data;
  const committee = committeeResult.data.interpretation;
  const da = devilsAdvocateResult.data;
  const { full, companyName } = gathered;
  const currentPrice = gathered.currentPrice;

  const twelveMonth = forecast.interpretation.horizons.find((h) => h.horizon === "12_month");
  if (!twelveMonth) {
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Forecast did not include a 12-month horizon." } };
  }

  // Reflect the Devil's Advocate's revision if one genuinely happened --
  // otherwise the report should show the Committee's original conclusion.
  const finalRating = da.committeeReview.wasThesisRevised
    ? da.committeeReview.revisedRating!
    : committee.finalRecommendation;
  const finalConfidence = da.committeeReview.wasThesisRevised
    ? da.committeeReview.revisedConfidence!
    : committee.finalConfidence;

  const news: NewsIntelligenceResult | null = newsResult.ok ? newsResult.data : null;
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
        didItChangeAnything: da.committeeReview.wasThesisRevised,
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
