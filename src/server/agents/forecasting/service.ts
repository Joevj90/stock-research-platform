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
import { typicalMoveByHorizonPct, widenRangeToVolatility, type VolatilityInputs } from "./volatility";

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

  // The stock's own measured volatility, used in two places: handed to
  // the model so its ranges have a sense of scale, and applied in code
  // afterwards as a floor (see ./volatility.ts for the measurements that
  // forced this).
  const volatility: VolatilityInputs = {
    volatilityAnnualizedPct: summaries.technicalSummary?.volatilityAnnualizedPct ?? null,
    atrPct: summaries.technicalSummary?.atrPct ?? null,
  };

  const interpreterInput: ForecastInterpreterInput = {
    ticker,
    companyName,
    currentPrice,
    typicalMoveByHorizonPct: typicalMoveByHorizonPct(volatility),
    ...summaries,
  };

  const interpretationResult = await interpretForecast(interpreterInput);
  if (!interpretationResult.ok) {
    log.warn("forecast inputs gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  const interpretation = finalizeInterpretation(interpretationResult.data, currentPrice, volatility);

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
function finalizeInterpretation(
  raw: RawForecastInterpretation,
  currentPrice: number,
  volatility: VolatilityInputs
): ForecastInterpretation {
  const horizons: HorizonForecast[] = raw.horizons.map((h) => {
    const normalizedProbs = normalizeProbabilities(h.bear.probabilityPct, h.base.probabilityPct, h.bull.probabilityPct);

    // Enforce the volatility floor on the raw targets, BEFORE rounding
    // and before any return is computed, so every downstream number --
    // scenario returns, expected price, the stored prediction record --
    // describes the same range the reader is shown. The base case is
    // never moved; only the tails.
    const widened = widenRangeToVolatility({
      scenarios: { bear: h.bear.priceTarget, base: h.base.priceTarget, bull: h.bull.priceTarget },
      currentPrice,
      horizon: h.horizon,
      volatility,
    });

    const bearPrice = roundPriceForDisplay(widened.bear);
    const basePrice = roundPriceForDisplay(widened.base);
    const bullPrice = roundPriceForDisplay(widened.bull);

    // Scenario returns use the AI's unrounded targets for the same reason
    // the expected return does (see below); the rounded prices are what
    // get displayed and stored as targets.
    const bear: ScenarioOutcome = {
      scenario: "bear",
      explanation: h.bear.explanation,
      estimatedFinancialOutcome: h.bear.estimatedFinancialOutcome,
      priceTarget: bearPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(widened.bear, currentPrice)),
      probabilityPct: normalizedProbs.bear,
      mainReasons: h.bear.mainReasons,
      keyRisks: h.bear.keyRisks,
    };
    const base: ScenarioOutcome = {
      scenario: "base",
      explanation: h.base.explanation,
      estimatedFinancialOutcome: h.base.estimatedFinancialOutcome,
      priceTarget: basePrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(widened.base, currentPrice)),
      probabilityPct: normalizedProbs.base,
      mainReasons: h.base.mainReasons,
      keyRisks: h.base.keyRisks,
    };
    const bull: ScenarioOutcome = {
      scenario: "bull",
      explanation: h.bull.explanation,
      estimatedFinancialOutcome: h.bull.estimatedFinancialOutcome,
      priceTarget: bullPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(widened.bull, currentPrice)),
      probabilityPct: normalizedProbs.bull,
      mainReasons: h.bull.mainReasons,
      keyRisks: h.bull.keyRisks,
    };

    // Weighted from the UNROUNDED targets, for the same reason the
    // returns are: rounding each of three inputs and then averaging
    // them bakes three rounding errors into the headline figure.
    const expectedPriceRaw = computeExpectedPrice({
      bear: { priceTarget: widened.bear, probabilityPct: bear.probabilityPct },
      base: { priceTarget: widened.base, probabilityPct: base.probabilityPct },
      bull: { priceTarget: widened.bull, probabilityPct: bull.probabilityPct },
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
