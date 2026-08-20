import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockMarketDataProvider } from "./mock-provider";
import type { MarketDataProvider } from "./provider.interface";

const log = logger.child("market-data:factory");

/**
 * Provider factory. Which concrete provider is used is entirely driven by
 * MARKET_DATA_PROVIDER — nothing else in the app should ever import
 * MockMarketDataProvider or a future AlphaVantageProvider directly.
 *
 * Phase 1: only "mock" is implemented. Selecting a real provider without
 * having implemented it fails loudly at startup rather than silently
 * falling back to mock data.
 */
function createProvider(): MarketDataProvider {
  switch (env.MARKET_DATA_PROVIDER) {
    case "mock":
      log.info("using mock market data provider (no real market data configured)");
      return new MockMarketDataProvider();
    case "alpha_vantage":
    case "finnhub":
      throw new Error(
        `MARKET_DATA_PROVIDER="${env.MARKET_DATA_PROVIDER}" is not implemented yet in Phase 1. ` +
          `Set MARKET_DATA_PROVIDER=mock, or implement this provider against MarketDataProvider.`
      );
    default: {
      const exhaustive: never = env.MARKET_DATA_PROVIDER;
      throw new Error(`Unhandled provider: ${exhaustive}`);
    }
  }
}

export const marketDataProvider: MarketDataProvider = createProvider();
export type { MarketDataProvider } from "./provider.interface";
export { getStockSnapshot } from "./snapshot";
