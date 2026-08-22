import { gatherAnalysisSummaries, type GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import { interpretPersonas } from "./personas-interpreter";
import { interpretDebate } from "./debate-interpreter";
import { computeVoteTally } from "./vote-tally";

const log = logger.child("agents:investment-committee");

const MODEL = "claude-sonnet-5";

/**
 * The AI Investment Committee -- a second top-level synthesis agent,
 * architecturally parallel to (not nested inside) the Forecasting Agent.
 *
 * Integration, not duplication: uses the SAME `gatherAnalysisSummaries`
 * shared gatherer the Forecasting Agent uses (Step 14) for its real
 * evidence base -- one place in the app calls the 8 analysis agents and
 * builds their summaries, reused by both synthesis agents.
 *
 * Two AI calls, not six: rather than spinning up five separate API calls
 * for five personas plus another for debate/consensus, Phase 1
 * (`interpretPersonas`) generates all five personas' independent
 * evaluations in a single structured call, and Phase 2
 * (`interpretDebate`) receives Phase 1's results as FIXED input to
 * produce genuine debate/consensus. The vote tally itself -- how many
 * personas said buy/hold/sell -- is counted deterministically in code
 * (`vote-tally.ts`), never trusted to either AI call's own arithmetic.
 *
 * Like the Forecasting Agent, this is an expensive, slow action (two AI
 * calls on top of whatever the 8 underlying agents cost) and degrades
 * gracefully: if a sub-agent's data isn't available, the committee still
 * proceeds using whatever real evidence exists.
 */
/**
 * @param precomputedGathered Optional -- see the identical parameter on
 * `runForecast`. Lets the Devil's Advocate agent reuse one evidence
 * gather across both this and Forecasting Agent instead of tripling it.
 */
export async function runInvestmentCommittee(
  rawTicker: string,
  precomputedGathered?: GatheredAnalysisInputs
): Promise<Result<CommitteeResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const gathered = precomputedGathered ?? (await gatherAnalysisSummaries(ticker));
  if (gathered.currentPrice === null) {
    return {
      ok: false,
      error: { code: "INVALID_TICKER", message: `Could not find price data for "${ticker}".` },
    };
  }

  const { companyName, inputsUsed, summaries } = gathered;

  const personasResult = await interpretPersonas({ ticker, companyName, ...summaries });
  if (!personasResult.ok) {
    log.warn("committee evidence gathered but personas phase failed", { ticker, error: personasResult.error });
    return personasResult;
  }

  const personaEvaluations = personasResult.data;
  const voteTally = computeVoteTally(personaEvaluations);

  const debateResult = await interpretDebate({
    ticker,
    companyName,
    personaEvaluations,
    ...summaries,
  });
  if (!debateResult.ok) {
    log.warn("committee personas formed but debate phase failed", { ticker, error: debateResult.error });
    return debateResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      inputsUsed,
      interpretation: {
        source: "ai",
        model: MODEL,
        generatedAt: new Date().toISOString(),
        personaEvaluations,
        voteTally,
        keyAgreements: debateResult.data.keyAgreements,
        keyDisagreements: debateResult.data.keyDisagreements,
        debateExchanges: debateResult.data.debateExchanges,
        finalRecommendation: debateResult.data.finalRecommendation,
        finalConfidence: debateResult.data.finalConfidence,
        recommendationRationale: debateResult.data.recommendationRationale,
        minorityViewWorthConsidering: debateResult.data.minorityViewWorthConsidering,
        overallConclusion: debateResult.data.overallConclusion,
      },
    },
  };
}
