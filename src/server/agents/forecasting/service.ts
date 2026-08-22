import { getStockSnapshot } from "@/server/market-data";
import { runTechnicalAnalysis } from "@/server/agents/technical-analysis";
import { runFundamentalAnalysis } from "@/server/agents/fundamental-analyst";
import { runValuationAnalysis } from "@/server/agents/valuation-engine";
import { runSentimentAnalysis } from "@/server/agents/sentiment-analysis";
import { runMacroAnalysis } from "@/server/agents/macro-analysis";
import { runCompetitorAnalysis } from "@/server/agents/competitor-analysis";
import { runManagementAnalysis } from "@/server/agents/management-analysis";
import { runRiskAnalysis } from "@/server/agents/risk-analyst";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type {
  ForecastInputsAvailability,
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
 * calls the REAL run functions of every other analysis agent built in
 * Steps 4, 6, 8, 9, 10, 11, 12, and 13, all in parallel, and uses their
 * actual outputs as inputs -- it never re-implements or re-derives any
 * of their analysis. "Do not create duplicate versions of these
 * analyses" is enforced structurally: there is no other code path here
 * that computes a technical score, a fundamental score, a DCF estimate,
 * etc. -- those numbers can only come from the real agents.
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
export async function runForecast(rawTicker: string): Promise<Result<ForecastResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const snapshotResult = await getStockSnapshot(ticker, "1M");
  if (!snapshotResult.ok) return snapshotResult;

  const currentPrice = snapshotResult.data.quote.price;
  const companyName = snapshotResult.data.companyName;

  const [technical, fundamental, valuation, sentiment, macro, competitor, management, risk] =
    await Promise.all([
      runTechnicalAnalysis(ticker).catch(() => null),
      runFundamentalAnalysis(ticker).catch(() => null),
      runValuationAnalysis(ticker).catch(() => null),
      runSentimentAnalysis(ticker).catch(() => null),
      runMacroAnalysis(ticker).catch(() => null),
      runCompetitorAnalysis(ticker).catch(() => null),
      runManagementAnalysis(ticker).catch(() => null),
      runRiskAnalysis(ticker).catch(() => null),
    ]);

  const inputsUsed: ForecastInputsAvailability = {
    technical: technical?.ok === true,
    fundamental: fundamental?.ok === true,
    valuation: valuation?.ok === true,
    sentiment: sentiment?.ok === true,
    macro: macro?.ok === true,
    competitor: competitor?.ok === true,
    management: management?.ok === true,
    risk: risk?.ok === true,
  };

  log.info("forecast inputs gathered", { ticker, inputsUsed });

  const interpreterInput: ForecastInterpreterInput = {
    ticker,
    companyName,
    currentPrice,
    valuationDcfEstimates:
      valuation?.ok === true
        ? {
            bearFairValue: valuation.data.dcf.bear.fairValuePerShare,
            baseFairValue: valuation.data.dcf.base.fairValuePerShare,
            bullFairValue: valuation.data.dcf.bull.fairValuePerShare,
          }
        : null,
    technicalSummary:
      technical?.ok === true
        ? {
            trend: technical.data.interpretation.trend,
            momentum: technical.data.interpretation.momentum,
            technicalScore: technical.data.interpretation.technicalScore,
            explanation: technical.data.interpretation.explanation,
          }
        : null,
    fundamentalSummary:
      fundamental?.ok === true
        ? {
            overallFundamentalScore: fundamental.data.interpretation.overallFundamentalScore,
            overallConclusion: fundamental.data.interpretation.overallConclusion,
          }
        : null,
    sentimentSummary:
      sentiment?.ok === true
        ? {
            sentimentScore: sentiment.data.interpretation.sentimentScore,
            sentimentDirection: sentiment.data.interpretation.sentimentDirection,
            sentimentTrend: sentiment.data.interpretation.sentimentTrend,
            overallConclusion: sentiment.data.interpretation.overallConclusion,
          }
        : null,
    macroSummary:
      macro?.ok === true
        ? {
            macroScore: macro.data.interpretation.macroScore,
            overallMacroEnvironment: macro.data.interpretation.overallMacroEnvironment,
            overallConclusion: macro.data.interpretation.overallConclusion,
          }
        : null,
    competitorSummary:
      competitor?.ok === true
        ? {
            competitiveScore: competitor.data.interpretation.competitiveScore,
            whoIsWinning: competitor.data.interpretation.whoIsWinning,
            biggestCompetitiveThreat: competitor.data.interpretation.biggestCompetitiveThreat,
          }
        : null,
    managementSummary:
      management?.ok === true
        ? {
            managementScore: management.data.interpretation.managementScore,
            overallAssessment: management.data.interpretation.overallAssessment,
            overallConclusion: management.data.interpretation.overallConclusion,
          }
        : null,
    riskSummary:
      risk?.ok === true
        ? {
            riskScore: risk.data.interpretation.riskScore,
            riskLevel: risk.data.interpretation.riskLevel,
            numberOneRisk: risk.data.interpretation.numberOneRisk.risk,
            overallConclusion: risk.data.interpretation.overallConclusion,
          }
        : null,
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

    const bear: ScenarioOutcome = {
      scenario: "bear",
      explanation: h.bear.explanation,
      estimatedFinancialOutcome: h.bear.estimatedFinancialOutcome,
      priceTarget: bearPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(bearPrice, currentPrice)),
      probabilityPct: normalizedProbs.bear,
      mainReasons: h.bear.mainReasons,
      keyRisks: h.bear.keyRisks,
    };
    const base: ScenarioOutcome = {
      scenario: "base",
      explanation: h.base.explanation,
      estimatedFinancialOutcome: h.base.estimatedFinancialOutcome,
      priceTarget: basePrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(basePrice, currentPrice)),
      probabilityPct: normalizedProbs.base,
      mainReasons: h.base.mainReasons,
      keyRisks: h.base.keyRisks,
    };
    const bull: ScenarioOutcome = {
      scenario: "bull",
      explanation: h.bull.explanation,
      estimatedFinancialOutcome: h.bull.estimatedFinancialOutcome,
      priceTarget: bullPrice,
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(bullPrice, currentPrice)),
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
      expectedReturnPct: roundReturnPct(computeExpectedReturnPct(expectedPrice, currentPrice)),
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
