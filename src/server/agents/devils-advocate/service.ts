import { gatherAnalysisSummaries, type GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import { runForecast } from "@/server/agents/forecasting";
import { runInvestmentCommittee } from "@/server/agents/investment-committee";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";
import { interpretDevilsAdvocate } from "./interpreter";

const log = logger.child("agents:devils-advocate");

export interface DevilsAdvocatePrecomputed {
  gathered: GatheredAnalysisInputs;
  forecastResult: Result<ForecastResult>;
  committeeResult: Result<CommitteeResult>;
}

/**
 * The Devil's Advocate.
 *
 * Integration, not duplication -- and a real cost-control decision on
 * top of it: this agent needs the SAME evidence Forecasting Agent and
 * the Investment Committee use, plus their actual conclusions to
 * challenge. Naively calling `runForecast` and `runInvestmentCommittee`
 * as black boxes would mean each re-gathers all 8 base agents
 * internally -- three redundant rounds of the same 8 (partly AI-backed)
 * calls. Instead this agent calls `gatherAnalysisSummaries` exactly
 * ONCE and passes that same evidence into both `runForecast` and
 * `runInvestmentCommittee` via their `precomputedGathered` parameter
 * (added this step, additive and backward-compatible -- their own full
 * test suites were re-verified after that change before this agent was
 * built on top of it).
 *
 * @param precomputed Optional -- if a caller (the Final Report, Step 17)
 * already has a fresh gather + Forecast + Committee result, pass them
 * here to skip re-deriving them entirely. This means Final Report can
 * reuse this agent's exact chain at ZERO additional AI-call cost beyond
 * what Devil's Advocate alone already costs.
 *
 * Even with these optimizations, this is genuinely the most expensive
 * single action in the app: one shared 8-agent gather, plus Forecasting
 * Agent's own synthesis call, plus the Investment Committee's two-phase
 * synthesis, plus this agent's own critique call.
 */
export async function runDevilsAdvocate(
  rawTicker: string,
  precomputed?: DevilsAdvocatePrecomputed
): Promise<Result<DevilsAdvocateResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const gathered = precomputed?.gathered ?? (await gatherAnalysisSummaries(ticker));
  if (gathered.currentPrice === null) {
    return {
      ok: false,
      error: { code: "INVALID_TICKER", message: `Could not find price data for "${ticker}".` },
    };
  }

  const { companyName, currentPrice, summaries } = gathered;

  const [forecastResult, committeeResult] = precomputed
    ? [precomputed.forecastResult, precomputed.committeeResult]
    : await Promise.all([runForecast(ticker, gathered), runInvestmentCommittee(ticker, gathered)]);

  // The Devil's Advocate cannot challenge a conclusion that doesn't
  // exist -- if the Committee failed to form one, propagate that error
  // rather than inventing something to critique.
  if (!committeeResult.ok) {
    log.warn("devil's advocate could not obtain a committee conclusion to challenge", {
      ticker,
      error: committeeResult.error,
    });
    return committeeResult;
  }

  const committee = committeeResult.data.interpretation;
  const twelveMonth = forecastResult.ok
    ? forecastResult.data.interpretation.horizons.find((h) => h.horizon === "12_month") ?? null
    : null;

  const interpretationResult = await interpretDevilsAdvocate({
    ticker,
    companyName,
    currentPrice,
    ...summaries,
    committee: {
      finalRecommendation: committee.finalRecommendation,
      finalConfidence: committee.finalConfidence,
      voteTally: committee.voteTally,
      keyAgreements: committee.keyAgreements,
      keyDisagreements: committee.keyDisagreements,
      recommendationRationale: committee.recommendationRationale,
    },
    forecastTwelveMonth: twelveMonth
      ? {
          horizon: twelveMonth.horizon,
          bear: twelveMonth.bear,
          base: twelveMonth.base,
          bull: twelveMonth.bull,
          expectedPrice: twelveMonth.expectedPrice,
          expectedReturnPct: twelveMonth.expectedReturnPct,
          confidenceScore: forecastResult.ok ? forecastResult.data.interpretation.confidenceScore : 0,
        }
      : null,
  });

  if (!interpretationResult.ok) {
    log.warn("devil's advocate evidence gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      originalCommitteeRating: committee.finalRecommendation,
      originalCommitteeConfidence: committee.finalConfidence,
      interpretation: interpretationResult.data.interpretation,
      committeeReview: interpretationResult.data.committeeReview,
      gathered,
      forecast: forecastResult.ok ? forecastResult.data : null,
      committee: committeeResult.data,
    },
  };
}
