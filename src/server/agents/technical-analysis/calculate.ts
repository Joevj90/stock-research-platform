import type { PriceBar, HistoricalPeriod } from "@/lib/types";
import {
  simpleMovingAverage,
  exponentialMovingAverage,
  relativeStrengthIndex,
  macd,
  bollingerBands,
  averageTrueRange,
  volumeTrend,
  annualizedVolatility,
  rateOfChange,
  detectSupportResistance,
} from "@/lib/technical-indicators";
import type { CalculatedTechnicalMetrics } from "./types";

/**
 * Runs every deterministic indicator calculation over real price bars and
 * assembles the "calculated" half of the Technical Analysis Agent's
 * output. This function contains zero AI calls and zero randomness — the
 * same input bars always produce the exact same output. See
 * src/lib/technical-indicators.ts for the individual formulas.
 */
export function calculateTechnicalMetrics(
  ticker: string,
  period: HistoricalPeriod,
  bars: PriceBar[]
): CalculatedTechnicalMetrics {
  const last = (arr: (number | null)[]): number | null =>
    arr.length > 0 ? arr[arr.length - 1]! : null;

  const sma20 = last(simpleMovingAverage(bars, 20));
  const sma50 = last(simpleMovingAverage(bars, 50));
  const sma100 = last(simpleMovingAverage(bars, 100));
  const sma200 = last(simpleMovingAverage(bars, 200));
  const ema20 = last(exponentialMovingAverage(bars, 20));
  const rsi14 = last(relativeStrengthIndex(bars, 14));
  const macdResult = macd(bars, 12, 26, 9);
  const bb = bollingerBands(bars, 20, 2);
  const atr14 = last(averageTrueRange(bars, 14));
  const vol = volumeTrend(bars, 20);
  const volatility = annualizedVolatility(bars, 20);
  const roc10 = rateOfChange(bars, 10);
  const { support, resistance } = detectSupportResistance(bars, 5, 3);

  const latestBar = bars[bars.length - 1];

  return {
    source: "calculated",
    ticker,
    period,
    barsUsed: bars.length,
    asOf: latestBar ? latestBar.timestamp : new Date().toISOString(),
    sma20,
    sma50,
    sma100,
    sma200,
    ema20,
    rsi14,
    macd: {
      line: last(macdResult.line),
      signal: last(macdResult.signal),
      histogram: last(macdResult.histogram),
    },
    bollingerBands: {
      upper: last(bb.upper),
      middle: last(bb.middle),
      lower: last(bb.lower),
    },
    atr14,
    volumeTrend: {
      latestVolume: vol.latestVolume,
      averageVolume20: vol.averageVolume,
      ratio: vol.ratio,
    },
    volatilityAnnualizedPct: volatility,
    momentum: {
      rateOfChange10Pct: roc10,
    },
    supportLevels: support,
    resistanceLevels: resistance,
    currentPrice: latestBar ? latestBar.close : 0,
  };
}
