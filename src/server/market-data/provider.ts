import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockMarketDataProvider } from "./mock-provider";
import { FmpMarketDataProvider } from "./fmp-provider";
import type { MarketDataProvider } from "./provider.interface";

const log = logger.child("market-data:factory");

/**
 * Provider factory. Which concrete provider is used is entirely driven by
 * MARKET_DATA_PROVIDER — nothing outside this module should ever import
 * MockMarketDataProvider or FmpMarketDataProvider directly, and nothing
 * outside `service.ts` should even import the `marketDataProvider`
 * singleton this file produces (see service.ts's boundary comment).
 *
 * Selecting a provider that isn't implemented fails loudly at startup
 * rather than silently falling back to mock data.
 */
function createProvider(): MarketDataProvider {
  switch (env.MARKET_DATA_PROVIDER) {
    case "mock":
      log.info("using mock market data provider (no real market data configured)");
      return new MockMarketDataProvider();
    case "fmp":
      log.info("using Financial Modeling Prep market data provider");
      return new FmpMarketDataProvider(env.FMP_API_KEY ?? "");
    case "alpha_vantage":
    case "finnhub":
      throw new Error(
        `MARKET_DATA_PROVIDER="${env.MARKET_DATA_PROVIDER}" is not implemented. ` +
          `Set MARKET_DATA_PROVIDER=mock or fmp, or implement this provider against MarketDataProvider.`
      );
    default: {
      const exhaustive: never = env.MARKET_DATA_PROVIDER;
      throw new Error(`Unhandled provider: ${exhaustive}`);
    }
  }
}

export const marketDataProvider: MarketDataProvider = createProvider();
