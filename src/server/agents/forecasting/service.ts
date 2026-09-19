import { gatherAnalysisSummaries, type GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type {
  ForecastInterpretation,
  ForecastResult,
  HorizonForecast,
  ScenarioOutcome,
} from "@/lib/forecast-types";
import { interpretForecast, type ForecastInterpreterInput, type RawForecastInterpretation } from "./interpreter";
import {
  computeExpectedPrice,
  computeExpectedReturnPct,
  normalizeProbabilities,
  roundPriceForDisplay,
  roundReturnPct,
} from "./calculations";

const log = logger.child("agents:forecasting");

/**
 * The Forecasting Agent -- the master synthesis agent.
 *
 * Integration, not duplication, taken to its full extent: this agent
 * uses `gatherAnalysisSummaries` (`@/server/agents/shared`) to call the
 * REAL run functions of every other analysis agent built in Steps 4, 6,
 * 8, 9, 10, 11, 12, and 13, all in parallel, and uses their actual
 * outputs as inputs -- it never re-implements or re-derives any of their
 * analysis. That gathering logic is shared with the Investment Committee
 * (Step 15), so there is exactly one place in the app that calls all 8
 * agents and builds these summaries.
 *
 * This is also, honestly, the most expensive single action in the app --
 * up to 8 other AI agents (some of which internally call News
 * Intelligence themselves) plus this agent's own synthesis call. Each
 * sub-agent call is handled independently: if one fails (e.g. an FMP
 * plan limitation, or that specific AI call erroring), the forecast
 * still proceeds using whatever succeeded, with `inputsUsed` recording
 * exactly which modules actually contributed -- "combine the available
 * evidence" rather than requiring every single input to succeed.
 */
/**
 * @param precomputedGathered Optional -- if the caller already has a
 * fresh `gatherAnalysisSummaries` result (e.g. the Devil's Advocate agent,
 * which needs the same evidence for multiple purposes), pass it here to
 * skip a redundant re-gather. Backward compatible: existing callers that
 * omit this behave exactly as before.
 */
export async function runForecast(
  rawTicker: string,
  precomputedGathered?: GatheredAnalysisInputs
): Promise<Result<ForecastResult>> {
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

  const { currentPrice, companyName, inputsUsed, summaries } = gathered;

  const interpreterInput: ForecastInterpreterInput = {
    ticker,
    companyName,
    currentPrice,
    ...summaries,
  };

  const interpretationResult = await interpretForecast(interpreterInput);
  if (!interpretationResult.ok) {
    log.warn("forecast inputs gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  const interpretation = finalizeInterpretation(interpretationResult.data, currentPrice);

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      currentPrice,
      generatedAt: new Date().toISOString(),
      inputsUsed,
      interpretation,
    },
  };
}

/**
 * Applies the deterministic calculations (probability normalization,
 * expected price, expected return, no-false-precision rounding) to the
 * AI's raw scenario numbers -- "Perform this calculation deterministically
 * in backend code rather than relying on the LLM." This is the ONLY place
 * those numbers are computed.
 */
function finalizeInterpretation(raw: RawForecastInterpretation, currentPrice: number): ForecastInterpretation {
  const horizons: HorizonForecast[] = raw.horizons.map((h) => {
    const normalizedProbs = normalizeProbabilities(h.bear.probabilityPct, h.base.probabilityPct, h.bull.probabilityPct);

    const bearPrice = roundPriceForDisplay(h.bear.priceTarget);
    const basePrice = roundPriceForDisplay(h.base.priceTarget);
    const bullPrice = roundPriceForDisplay(h.bull.priceTarget);

    // Scenario returns use the AI's unrounded targets for the same reason
    // the expected return does (see below); the rounded prices are what
    // get displayed and stored as targets.
    const bear: ScenarioOutcome = {
      scenario: "bear",
      explanation: h.bear.explanation,
      estimatedFinancialOutcome: h.bear.estimatedFinancialOutcome,
      priceTarget: bearPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(h.bear.priceTarget, currentPrice)),
      probabilityPct: normalizedProbs.bear,
      mainReasons: h.bear.mainReasons,
      keyRisks: h.bear.keyRisks,
    };
    const base: ScenarioOutcome = {
      scenario: "base",
      explanation: h.base.explanation,
      estimatedFinancialOutcome: h.base.estimatedFinancialOutcome,
      priceTarget: basePrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(h.base.priceTarget, currentPrice)),
      probabilityPct: normalizedProbs.base,
      mainReasons: h.base.mainReasons,
      keyRisks: h.base.keyRisks,
    };
    const bull: ScenarioOutcome = {
      scenario: "bull",
      explanation: h.bull.explanation,
      estimatedFinancialOutcome: h.bull.estimatedFinancialOutcome,
      priceTarget: bullPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(h.bull.priceTarget, currentPrice)),
      probabilityPct: normalizedProbs.bull,
      mainReasons: h.bull.mainReasons,
      keyRisks: h.bull.keyRisks,
    };

    const expectedPriceRaw = computeExpectedPrice({
      bear: { priceTarget: bear.priceTarget, probabilityPct: bear.probabilityPct },
      base: { priceTarget: base.priceTarget, probabilityPct: base.probabilityPct },
      bull: { priceTarget: bull.priceTarget, probabilityPct: bull.probabilityPct },
    });
    const expectedPrice = roundPriceForDisplay(expectedPriceRaw);

    return {
      horizon: h.horizon,
      dataSupportsThisHorizon: h.dataSupportsThisHorizon,
      limitationNote: h.limitationNote,
      bear,
      base,
      bull,
      expectedPrice,
      // Computed from the UNROUNDED expected price. Rounding is for
      // display only; feeding the rounded figure back into the return
      // calculation compounds two roundings into the headline number.
      // On short horizons, where the whole expected move can be under
      // 1%, that is enough to change the answer: a CAVA 1-week forecast
      // with a true expected price of $51.20 was rounded to $51.00 and
      // reported as -1.2% when the real figure was -0.9%.
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(expectedPriceRaw, currentPrice)),
      mostLikelyScenario: h.mostLikelyScenario,
    };
  });

  return {
    source: raw.source,
    model: raw.model,
    generatedAt: raw.generatedAt,
    horizons,
    keyCatalysts: raw.keyCatalysts,
    keyRisksSummary: raw.keyRisksSummary,
    confidenceScore: raw.confidenceScore,
    confidenceExplanation: raw.confidenceExplanation,
    biggestOptimismReason: raw.biggestOptimismReason,
    biggestRiskReason: raw.biggestRiskReason,
    assumptions: raw.assumptions,
    overallConclusion: raw.overallConclusion,
  };
}
