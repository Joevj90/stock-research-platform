import type { CommitteeRecommendation } from "@/lib/investment-committee-types";
import type { ScenarioOutcome } from "@/lib/forecast-types";
import type { ValuationRating } from "@/lib/valuation-types";
import type { OverallMacroEnvironment } from "@/lib/macro-types";
import type { SentimentDirection, SentimentTrend } from "@/lib/sentiment-types";
import type { RiskItem } from "@/lib/risk-types";
import type { WhatsHappeningSummary } from "@/lib/news-types";

/**
 * Final AI Investment Report domain types.
 *
 * This step is explicitly a PRESENTATION/AGGREGATION layer, not a new
 * analysis layer -- "do not independently calculate new financial
 * metrics unless necessary" and "must use existing outputs" are taken
 * literally here. Every field in this file is either:
 *   - copied directly from an existing agent's real output (FACT /
 *     already-computed CALCULATION / already-produced AI INTERPRETATION,
 *     depending on which upstream agent it came from), or
 *   - a deterministic label bucketed from an existing numeric score
 *     (e.g. -100..100 -> STRONG/GOOD/AVERAGE/WEAK/VERY_WEAK), which is
 *     formatting, not new analysis.
 *
 * No new AI call is made in this step -- see service.ts's doc comment
 * for why, and for exactly which upstream field feeds each section.
 */

export type QualityLabel = "strong" | "good" | "average" | "weak" | "very_weak" | "unavailable";

export interface QuickAnswer {
  rating: CommitteeRecommendation;
  currentPrice: number;
  expectedPrice: number;
  expectedReturnPct: number;
  confidenceScore: number; // 0..100
  explanation: string; // reused verbatim from an existing agent's real conclusion text
}

export interface BearBaseBull {
  bear: ScenarioOutcome;
  base: ScenarioOutcome;
  bull: ScenarioOutcome;
  expectedPrice: number;
  expectedReturnPct: number;
}

export interface BusinessQuality {
  financialHealth: QualityLabel;
  growth: QualityLabel;
  profitability: QualityLabel;
  competitivePosition: QualityLabel;
  management: QualityLabel;
  businessRisks: QualityLabel; // higher risk -> weaker label
  explanation: string;
}

export interface ValuationSummary {
  rating: ValuationRating;
  explanation: string;
}

export interface RecentDevelopment {
  headline: string;
  url: string;
  source: string;
  whatHappened: string;
  whyItMatters: string;
}

export interface WhatsHappeningNow {
  summary: WhatsHappeningSummary;
  topEvents: RecentDevelopment[]; // top 3-5, real, sourced
}

export interface MarketSentimentSummary {
  direction: SentimentDirection;
  trend: SentimentTrend;
  whatInvestorsLike: string[];
  whatInvestorsAreWorriedAbout: string[];
}

export interface EconomySummary {
  environment: OverallMacroEnvironment;
  explanation: string;
}

export interface CompetitionSummary {
  isWinning: string; // plain-language conclusion, reused from Competitor Analysis
  majorCompetitors: string[];
}

export interface ManagementSummary {
  assessment: string; // reused label text
  credibilityExplanation: string;
  capitalAllocationAssessment: string;
  concerns: string[];
}

export interface DevilsAdvocateSummary {
  whatCouldWeBeMissing: string[];
  strongestArgumentAgainst: string;
  didItChangeAnything: boolean;
  whatChanged: string | null;
}

export interface WhatWouldChangeAiMind {
  moreBearishIf: string[];
  lessWorriedIf: string[];
}

export interface FinalConclusion {
  bottomLine: string;
  rating: CommitteeRecommendation;
  confidenceScore: number;
  expectedReturnPct: number;
}

export interface ReportSource {
  label: string;
  url: string;
}

/** Where different agents' real numbers genuinely disagree (e.g. two
 * different implied valuation reads) -- "identify the conflict... never
 * silently choose a number without checking." Populated only when a
 * real, checkable discrepancy exists; empty array otherwise. */
export interface DataConsistencyNote {
  topic: string;
  description: string;
}

export interface FinalReportResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;

  quickAnswer: QuickAnswer;
  whyAiLikesIt: string[];
  whyAiIsWorried: string[];
  bearBaseBull: BearBaseBull;
  businessQuality: BusinessQuality;
  valuation: ValuationSummary;
  whatsHappeningNow: WhatsHappeningNow;
  marketSentiment: MarketSentimentSummary;
  economy: EconomySummary;
  competition: CompetitionSummary;
  management: ManagementSummary;
  biggestRisks: RiskItem[]; // top 3
  devilsAdvocate: DevilsAdvocateSummary;
  whatWouldChangeAiMind: WhatWouldChangeAiMind;
  finalConclusion: FinalConclusion;

  dataConsistencyNotes: DataConsistencyNote[];
  sources: ReportSource[];
}
