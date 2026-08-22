/**
 * Forecasting Agent domain types.
 *
 * FACT / ASSUMPTION / CALCULATION / FORECAST / AI INTERPRETATION, mapped:
 *   - FACT           = the current price and the real outputs of the
 *                       existing analysis modules this agent summarizes
 *                       (never re-fetched or re-derived here).
 *   - ASSUMPTION     = ForecastAssumption below -- explicit, labeled,
 *                       never presented as settled fact.
 *   - CALCULATION    = expectedPrice / expectedReturnPct on
 *                       HorizonForecast -- computed deterministically in
 *                       `calculations.ts` from the AI's scenario prices
 *                       and probabilities, never by asking the LLM to do
 *                       arithmetic. `probabilityPct` on each scenario is
 *                       also deterministically normalized to guarantee
 *                       the three sum to exactly 100.
 *   - FORECAST       = ScenarioOutcome.priceTarget -- explicitly an
 *                       estimate under stated assumptions, never a
 *                       guaranteed price (see the "no false precision"
 *                       rounding applied in calculations.ts).
 *   - AI INTERPRETATION = the scenario narratives, catalysts, and
 *                       confidence explanation -- tagged `source: "ai"`.
 */

export type ForecastHorizonKey = "3_month" | "6_month" | "12_month";
export type ScenarioName = "bear" | "base" | "bull";
export type CatalystImportance = "low" | "medium" | "high";

export interface ScenarioOutcome {
  scenario: ScenarioName;
  explanation: string;
  estimatedFinancialOutcome: string;
  priceTarget: number; // rounded for display -- see calculations.ts
  /** Deterministically computed from priceTarget vs. current price --
   * never asked of the LLM. */
  expectedReturnPct: number;
  /** Deterministically normalized so bear+base+bull always sum to
   * exactly 100 -- see calculations.ts. */
  probabilityPct: number;
  mainReasons: string[];
  keyRisks: string[];
}

export interface HorizonForecast {
  horizon: ForecastHorizonKey;
  dataSupportsThisHorizon: boolean;
  limitationNote: string | null; // required (non-null) when dataSupportsThisHorizon is false
  bear: ScenarioOutcome;
  base: ScenarioOutcome;
  bull: ScenarioOutcome;
  /** CALCULATION: probability-weighted average of the three scenario
   * prices, computed deterministically. */
  expectedPrice: number;
  /** CALCULATION: (expectedPrice - currentPrice) / currentPrice. */
  expectedReturnPct: number;
  mostLikelyScenario: ScenarioName;
}

export interface Catalyst {
  whatCouldHappen: string;
  whyItWouldHelp: string;
  importance: CatalystImportance;
}

export interface ForecastAssumption {
  assumption: string;
  explanation: string;
}

/** Which existing analysis modules actually contributed real data to
 * this forecast -- since any of them can fail independently (e.g. an
 * FMP plan limitation) without failing the whole forecast. */
export interface ForecastInputsAvailability {
  technical: boolean;
  fundamental: boolean;
  valuation: boolean;
  sentiment: boolean;
  macro: boolean;
  competitor: boolean;
  management: boolean;
  risk: boolean;
}

export interface ForecastInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  horizons: HorizonForecast[]; // one each for 3_month, 6_month, 12_month

  keyCatalysts: Catalyst[];
  /** Summarized from the Risk Analyst's findings, NOT a duplicate of the
   * full risk list -- just what matters most for this forecast. */
  keyRisksSummary: string[];

  confidenceScore: number; // 0..100 per this step's spec (note: a different scale from other agents' 0..1)
  confidenceExplanation: string;

  biggestOptimismReason: string;
  biggestRiskReason: string;

  assumptions: ForecastAssumption[];
  overallConclusion: string;
}

export interface ForecastResult {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  generatedAt: string;
  inputsUsed: ForecastInputsAvailability;
  interpretation: ForecastInterpretation;
}
