import type { HistoricalPeriod } from "@/lib/types";

/**
 * Every numeric technical indicator, computed deterministically in code
 * (see src/lib/technical-indicators.ts) from real historical price bars.
 * Nothing in this object is ever produced by an LLM — it's the
 * "calculated" half of the agent's output, kept structurally separate
 * from `TechnicalInterpretation` (the AI half) so a consumer can never
 * confuse the two.
 */
export interface CalculatedTechnicalMetrics {
  source: "calculated";
  ticker: string;
  period: HistoricalPeriod;
  barsUsed: number;
  asOf: string; // ISO timestamp of the most recent bar used

  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  bollingerBands: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
  atr14: number | null;
  volumeTrend: {
    latestVolume: number;
    averageVolume20: number | null;
    ratio: number | null;
  };
  volatilityAnnualizedPct: number | null;
  momentum: {
    rateOfChange10Pct: number | null;
  };
  supportLevels: number[]; // nearest first, below current price
  resistanceLevels: number[]; // nearest first, above current price
  currentPrice: number;
}

export type TrendLabel = "strong_uptrend" | "uptrend" | "sideways" | "downtrend" | "strong_downtrend";
export type MomentumLabel = "overbought" | "bullish" | "neutral" | "bearish" | "oversold";

/**
 * The AI's interpretation of `CalculatedTechnicalMetrics` — qualitative
 * framing (trend/momentum labels, bullish/bearish signals, a -100..+100
 * score, and a plain-English explanation). The model is instructed to
 * interpret the given numbers only, never to compute or estimate a
 * numeric indicator itself.
 */
export interface TechnicalInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;
  trend: TrendLabel;
  momentum: MomentumLabel;
  bullishSignals: string[];
  bearishSignals: string[];
  technicalScore: number; // -100..100
  explanation: string;
}

export interface TechnicalAnalysisResult {
  ticker: string;
  period: HistoricalPeriod;
  calculated: CalculatedTechnicalMetrics;
  interpretation: TechnicalInterpretation;
}
