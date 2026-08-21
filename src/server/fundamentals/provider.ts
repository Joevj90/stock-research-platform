import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockFundamentalsProvider } from "./mock-provider";
import { FmpFundamentalsProvider } from "./fmp-provider";
import type { FundamentalsProvider } from "./provider.interface";

const log = logger.child("fundamentals:factory");

/**
 * Provider factory for fundamentals -- mirrors
 * src/server/market-data/provider.ts. Nothing outside this module should
 * import a concrete provider directly, and nothing outside service.ts
 * should import the singleton this factory produces.
 */
function createProvider(): FundamentalsProvider {
  switch (env.FUNDAMENTALS_DATA_PROVIDER) {
    case "mock":
      log.info("using mock fundamentals provider (no real financial data configured)");
      return new MockFundamentalsProvider();
    case "fmp":
      log.info("using Financial Modeling Prep fundamentals provider");
      return new FmpFundamentalsProvider(env.FMP_API_KEY ?? "");
    default: {
      const exhaustive: never = env.FUNDAMENTALS_DATA_PROVIDER;
      throw new Error(`Unhandled fundamentals provider: ${exhaustive}`);
    }
  }
}

export const fundamentalsProvider: FundamentalsProvider = createProvider();
