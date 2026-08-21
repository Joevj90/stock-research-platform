/**
 * News Intelligence domain types.
 *
 * FACT / AI INTERPRETATION / POSSIBLE IMPACT separation, mirroring the
 * FACT/CALCULATION/AI-INTERPRETATION/CONCLUSION split used by the
 * Fundamental Analyst:
 *   - FACT               = NewsArticle below -- exactly what a provider
 *                           returned (headline, url, source, date), never
 *                           altered by AI. Every important event the AI
 *                           surfaces must point back to one of these.
 *   - AI INTERPRETATION   = whatHappened / whyItMatters on NewsEvent --
 *                           the model's plain-language reading.
 *   - POSSIBLE IMPACT     = possibleStockImpact / classification /
 *                           timeHorizon -- explicitly framed as
 *                           "possible", never stated as settled fact.
 */

export type NewsSentiment = "bullish" | "bearish" | "neutral";
export type TimeHorizon = "short_term" | "medium_term" | "long_term";
export type Importance = "low" | "medium" | "high" | "very_high";
export type RecencyType = "recent_event" | "ongoing_issue" | "historical_background";

/** A single real article exactly as retrieved from a provider -- the FACT
 * layer. Never written to or altered by the AI interpretation step. */
export interface NewsArticle {
  headline: string;
  url: string;
  source: string; // publisher name
  publishedAt: string; // ISO date
  summary: string | null; // provider-supplied snippet, if any
  sourceType: string | null; // provider-classified where available
  ticker: string;
  retrievedAt: string; // ISO datetime
  provider: string;
}

/** One "important" underlying event, potentially covered by more than one
 * article -- grouped so duplicate coverage of the same event isn't
 * mistaken for multiple distinct events. `primaryArticleUrl` and every
 * entry in `relatedArticleUrls` are validated (see interpreter.ts) to
 * match a real fetched NewsArticle's url -- the AI cannot reference a URL
 * that wasn't actually retrieved. */
export interface NewsEvent {
  primaryArticleUrl: string;
  relatedArticleUrls: string[]; // other articles covering the same event

  whatHappened: string;
  whyItMatters: string;
  possibleStockImpact: string;
  timeHorizon: TimeHorizon;
  timeHorizonExplanation: string; // plain-language "days/weeks vs months vs years"
  importance: Importance;
  classification: NewsSentiment;
  recencyType: RecencyType;
}

export interface WhatsHappeningSummary {
  positive: string[];
  negative: string[];
  neutral: string[];
}

export interface NewsIntelligenceInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;
  whatsHappening: WhatsHappeningSummary;
  importantEvents: NewsEvent[];
}

export interface NewsIntelligenceResult {
  ticker: string;
  fetchedAt: string;
  /** The FACT layer -- every real article the news service retrieved,
   * unmodified. `interpretation.importantEvents` is a curated, grouped
   * subset that always traces back to entries in this array. */
  articles: NewsArticle[];
  interpretation: NewsIntelligenceInterpretation;
}
