/**
 * Macro Analysis domain types.
 *
 * FACT / CALCULATION / AI INTERPRETATION / FORECAST, mapped:
 *   - FACT           = MacroIndicator below -- a real economic data point
 *                       with full provenance (source, URL, publication
 *                       date, retrieval date). Never invented.
 *   - CALCULATION    = there's no numeric derivation in this step (macro
 *                       indicators are used as-is); the "calculated"
 *                       layer here is simply the fetched, sourced dataset.
 *   - AI INTERPRETATION = MacroInterpretation below -- which of the real
 *                       indicators actually matter for THIS company, and
 *                       whether they help or hurt, tagged `source: "ai"`.
 *   - FORECAST       = none produced in this step; `timeHorizon` and risk
 *                       descriptions are framed as possibilities, not
 *                       predictions.
 */

export type MacroEffect = "positive" | "neutral" | "negative";
export type MacroTimeHorizon = "short_term" | "medium_term" | "long_term";
export type OverallMacroEnvironment = "favorable" | "neutral" | "unfavorable";

/** One real economic data point, with full provenance -- never
 * fabricated, and never presented without its source. */
export interface MacroIndicator {
  name: string; // e.g. "GDP", "CPI", "unemploymentRate", "treasury10Year"
  label: string; // human-readable, e.g. "GDP Growth"
  value: number;
  unit: string; // e.g. "%", "index"
  asOfDate: string; // ISO date -- when this figure was reported/released
  source: string; // publisher/provider name
  url: string | null;
  retrievedAt: string; // ISO datetime -- when this app fetched it
}

export interface MacroFactorAssessment {
  factor: string; // e.g. "Interest rates", "Consumer spending"
  whatIsHappening: string;
  whyItMattersToCompany: string;
  effect: MacroEffect;
  significance: "low" | "medium" | "high";
  timeHorizon: MacroTimeHorizon;
}

export interface MacroRisk {
  whatCouldHappen: string;
  whyItWouldMatter: string;
  effect: MacroEffect;
  significance: "low" | "medium" | "high";
}

export interface MacroInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  macroScore: number; // -100..100
  overallMacroEnvironment: OverallMacroEnvironment;
  confidenceScore: number; // 0..1

  positiveFactors: MacroFactorAssessment[];
  negativeFactors: MacroFactorAssessment[];
  mostImportantMacroFactor: string;
  biggestMacroRisk: MacroRisk;
  importantMacroRisks: MacroRisk[]; // 2-5, per spec

  timeHorizon: MacroTimeHorizon;
  overallConclusion: string;
}

export interface MacroResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  indicators: MacroIndicator[]; // the real FACT layer this analysis was built on
  interpretation: MacroInterpretation;
}
