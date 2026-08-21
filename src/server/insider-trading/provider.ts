import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockInsiderTradingProvider } from "./mock-provider";
import { FmpInsiderTradingProvider } from "./fmp-provider";
import type { InsiderTradingProvider } from "./provider.interface";

const log = logger.child("insider-trading:factory");

function createProvider(): InsiderTradingProvider {
  switch (env.INSIDER_TRADING_PROVIDER) {
    case "mock":
      log.info("using mock insider trading provider (no real transaction data configured)");
      return new MockInsiderTradingProvider();
    case "fmp":
      log.info("using Financial Modeling Prep insider trading provider");
      return new FmpInsiderTradingProvider(env.FMP_API_KEY ?? "");
    default: {
      const exhaustive: never = env.INSIDER_TRADING_PROVIDER;
      throw new Error(`Unhandled insider trading provider: ${exhaustive}`);
    }
  }
}

export const insiderTradingProvider: InsiderTradingProvider = createProvider();
