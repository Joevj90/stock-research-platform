import type { PriceBar } from "@/lib/types";
import type { MarketReactionSignal } from "@/lib/sentiment-types";
import { rateOfChange, volumeTrend } from "@/lib/technical-indicators";

/**
 * Deterministic market-reaction signal, computed with the exact same
 * pure functions the Technical Analysis Agent uses -- reused, not
 * reimplemented, per "integrate with the existing architecture rather
 * than creating duplicate systems." Zero AI, zero randomness.
 */
export function computeMarketReaction(bars: PriceBar[]): MarketReactionSignal {
  return {
    source: "calculated",
    recentPriceChangePct: rateOfChange(bars, 10),
    volumeVsAverage: volumeTrend(bars, 20).ratio,
  };
}
