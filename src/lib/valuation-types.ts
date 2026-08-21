/**
 * Valuation Engine domain types.
 *
 * FACT / CALCULATION / ASSUMPTION / FORECAST / AI INTERPRETATION, mapped:
 *   - FACT           = current price, market cap, and reported financials
 *                       already fetched by Steps 1-5 -- never restated here.
 *   - CALCULATION     = ValuationMetrics, HistoricalComparison,
 *                       PeerComparison, SensitivityGrid -- deterministic
 *                       math over real data, zero AI, zero randomness.
 *   - ASSUMPTION      = DcfAssumptions -- explicit, labeled inputs the DCF
 *                       model uses. Never presented as fact; always shown
 *                       alongside a plain-language explanation of what it
 *                       means and, for AI-set assumptions, why it was chosen.
 *   - FORECAST        = DcfScenario's projected fair value -- explicitly a
 *                       model output under stated assumptions, not a
 *                       prediction of certain future value.
 *   - AI INTERPRETATION = ValuationInterpretation -- the qualitative
 *                       rating and explanation, tagged `source: "ai"`.
 */

export type ValuationRating = "cheap" | "reasonably_priced" | "expensive" | "very_expensive";

/** One metric's value, or null with a reason when it isn't meaningful to
 * compute (e.g. P/E for a company with negative earnings) -- "Do not
 * calculate metrics when the underlying data is unavailable or not
 * meaningful" is enforced by always carrying a reason for a null. */
export interface MetricValue {
  value: number | null;
  unavailableReason: string | null;
}

export interface ValuationMetrics {
  source: "calculated";
  ticker: string;
  asOfPrice: number;
  asOfDate: string;

  peRatio: MetricValue;
  forwardPeRatio: MetricValue; // always unavailable in this step -- no forward-estimates data source yet
  pegRatio: MetricValue;
  evToEbitda: MetricValue;
  evToRevenue: MetricValue;
  priceToSales: MetricValue;
  priceToBook: MetricValue;
  freeCashFlowYieldPct: MetricValue;
  dividendYieldPct: MetricValue;
}

export interface HistoricalComparisonPoint {
  fiscalYear: number;
  peRatio: number | null;
  priceToSales: number | null;
}

export interface HistoricalComparison {
  source: "calculated";
  points: HistoricalComparisonPoint[]; // oldest first
  currentPeVsHistoricalAveragePct: number | null; // + means more expensive than its own history
  currentPsVsHistoricalAveragePct: number | null;
}

export interface PeerMetricSet {
  ticker: string;
  peRatio: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
}

export interface PeerComparison {
  source: "calculated";
  peers: PeerMetricSet[];
  averagePeRatio: number | null;
  averagePriceToSales: number | null;
  averageEvToEbitda: number | null;
  currentPeVsPeerAveragePct: number | null;
  currentPsVsPeerAveragePct: number | null;
}

/** Explicit, labeled DCF inputs -- an ASSUMPTION, never a FACT. */
export interface DcfAssumptions {
  initialRevenueGrowthPct: number;
  terminalRevenueGrowthPct: number; // growth fades linearly toward this by the final projection year
  operatingMarginPct: number;
  taxRatePct: number;
  capexAsPctOfRevenue: number;
  workingCapitalChangeAsPctOfRevenue: number;
  discountRatePct: number; // WACC proxy
  terminalGrowthRatePct: number;
  projectionYears: number;
}

export interface DcfScenario {
  name: "bear" | "base" | "bull";
  assumptions: DcfAssumptions;
  fairValuePerShare: number | null; // null if shares outstanding couldn't be derived
  impliedUpsideDownsidePct: number | null;
}

export interface SensitivityRow {
  parameter: "revenueGrowth" | "operatingMargin" | "discountRate" | "terminalGrowth";
  /** Each entry is a delta from the base-case value for that parameter,
   * and the resulting base-case fair value per share with only that one
   * parameter changed (others held at their base-case values). */
  results: { delta: number; fairValuePerShare: number | null }[];
}

export interface DcfResult {
  source: "calculated";
  bear: DcfScenario;
  base: DcfScenario;
  bull: DcfScenario;
  fairValueRangeLow: number | null;
  fairValueRangeHigh: number | null;
  sensitivity: SensitivityRow[];
  sharesOutstandingUsed: number | null;
  netDebtUsed: number | null;
}

/** Plain-language explanation of one assumption, generated once per
 * assumption key so the UI can show "what this means" next to the number
 * without duplicating the explanation text per scenario. */
export interface AssumptionExplanation {
  key: string;
  label: string;
  explanation: string;
}

export interface ValuationInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;
  rating: ValuationRating;
  explanation: string; // 2-5 sentences, plain language
  biggestUncertainty: string;
  assumptionExplanations: AssumptionExplanation[];
  confidenceScore: number; // 0..1
}

export interface ValuationResult {
  ticker: string;
  currentPrice: number;
  metrics: ValuationMetrics;
  historicalComparison: HistoricalComparison;
  peerComparison: PeerComparison;
  dcf: DcfResult;
  interpretation: ValuationInterpretation;
}
