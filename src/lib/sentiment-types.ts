/**
 * Sentiment Analysis domain types.
 *
 * FACT / SOURCE-BASED SENTIMENT / AI INTERPRETATION / CONCLUSION, mapped:
 *   - FACT                 = real price/volume data (Step 1) and real
 *                             financial-statement data (Step 5), used only
 *                             to compute deterministic signals here --
 *                             never restated as sentiment itself.
 *   - SOURCE-BASED SENTIMENT = the classified news events this agent
 *                             receives from Step 7 (News Intelligence) --
 *                             each already tagged bullish/bearish/neutral
 *                             by sources' own coverage, already
 *                             deduplicated and grouped by underlying
 *                             event. This agent treats these as inputs
 *                             representing what sources are saying, not
 *                             as its own opinion.
 *   - AI INTERPRETATION     = SentimentInterpretation below -- this
 *                             agent's own synthesis (score, trend,
 *                             comparisons), tagged `source: "ai"`.
 *   - CONCLUSION            = `overallConclusion` -- never presented as
 *                             a settled fact.
 *
 * No social-media data source is integrated in this build -- the AI is
 * explicitly instructed not to reference social media as if it had
 * access to it (see interpreter.ts's system prompt), so "social media
 * opinions treated as fact" cannot happen because none are ever supplied.
 */

export type SentimentDirection = "bullish" | "bearish" | "neutral";
export type SentimentTrend =
  | "strongly_improving"
  | "improving"
  | "stable"
  | "deteriorating"
  | "strongly_deteriorating";

/** WHAT IS HAPPENING? / WHY? / WHY DOES IT MATTER? -- the required
 * explanation shape for each major conclusion. */
export interface SentimentAssessment {
  whatIsHappening: string;
  why: string;
  whyItMatters: string;
}

/** Deterministic market-reaction signal -- pure arithmetic over real
 * price/volume history (Step 1), reusing the same formulas the Technical
 * Analysis Agent uses (src/lib/technical-indicators.ts). Zero AI. */
export interface MarketReactionSignal {
  source: "calculated";
  recentPriceChangePct: number | null; // ~2-week price move
  volumeVsAverage: number | null; // ratio, e.g. 1.3 = 30% above average
}

/** Deterministic, lightweight real-data signals used only to let the AI
 * compare sentiment against actual performance and valuation, without
 * triggering the (paid, separate) Fundamental Analyst or Valuation
 * Engine agents. Pure arithmetic over Step 5's real financial data. */
export interface FundamentalsSignal {
  source: "calculated";
  latestRevenueGrowthPct: number | null;
  latestNetIncomeGrowthPct: number | null;
  simplePeRatio: number | null; // price / eps, a lightweight valuation reference point
}

export interface SentimentInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  sentimentScore: number; // -100..100
  sentimentDirection: SentimentDirection;
  confidenceScore: number; // 0..1

  positiveFactors: string[];
  negativeFactors: string[];
  majorSentimentDrivers: string[];

  sentimentTrend: SentimentTrend;
  sentimentTrendExplanation: string;

  marketReaction: SentimentAssessment;
  sentimentVsFundamentals: SentimentAssessment;
  sentimentVsValuation: SentimentAssessment;

  overallConclusion: string;
}

export interface SentimentResult {
  ticker: string;
  generatedAt: string;
  /** The classified news events this analysis was built on -- pulled
   * directly from Step 7's News Intelligence output (already
   * deduplicated and classified), included here for transparency about
   * what the sentiment score was actually derived from. */
  newsEventCount: number;
  marketReaction: MarketReactionSignal;
  fundamentalsSignal: FundamentalsSignal;
  interpretation: SentimentInterpretation;
}
