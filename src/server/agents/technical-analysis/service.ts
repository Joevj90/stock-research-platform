import { getHistoricalPrices } from "@/server/market-data";
import { logger } from "@/server/logger";
import type { HistoricalPeriod, Result } from "@/lib/types";
import type { TechnicalAnalysisResult } from "./types";
import { calculateTechnicalMetrics } from "./calculate";
import { interpretTechnicalMetrics } from "./interpreter";

const log = logger.child("agents:technical-analysis");

/**
 * The Technical Analysis Agent.
 *
 * Data flow (matches the app's UI -> Backend -> Market Data Service ->
 * Provider architecture): this function calls `getHistoricalPrices` from
 * `@/server/market-data` -- the public market-data service barrel -- and
 * NEVER imports a provider or the provider factory directly. That's the
 * only way this agent is allowed to see market data, so every number it
 * works with is already cached, persisted, and rate-limit-safe by the
 * time it gets here.
 *
 * Everything numeric (SMA/EMA/RSI/MACD/Bollinger/ATR/volume/volatility/
 * momentum/support/resistance) is computed by `calculateTechnicalMetrics`
 * -- deterministic code, zero LLM involvement. Only the qualitative
 * synthesis (trend/momentum labels, bullish/bearish signals, the
 * technical score, and the explanation) comes from
 * `interpretTechnicalMetrics`, which is instructed to interpret those
 * numbers, never invent or recompute them. The returned result keeps
 * `calculated` and `interpretation` as separate, clearly labeled objects
 * (each carries its own `source` field) so no consumer can mistake one
 * for the other.
 */
export async function runTechnicalAnalysis(
  rawTicker: string,
  period: HistoricalPeriod = "1Y"
): Promise<Result<TechnicalAnalysisResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const historyResult = await getHistoricalPrices(ticker, period);
  if (!historyResult.ok) return historyResult;

  const bars = historyResult.data;
  if (bars.length === 0) {
    return {
      ok: false,
      error: { code: "INSUFFICIENT_DATA", message: `No price history available for ${ticker}.` },
    };
  }

  const calculated = calculateTechnicalMetrics(ticker, period, bars);

  const interpretationResult = await interpretTechnicalMetrics(calculated);
  if (!interpretationResult.ok) {
    log.warn("technical analysis calculated but not interpreted", {
      ticker,
      period,
      error: interpretationResult.error,
    });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      period,
      calculated,
      interpretation: interpretationResult.data,
    },
  };
}
