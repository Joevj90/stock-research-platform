import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockNewsProvider } from "./mock-provider";
import { FmpNewsProvider } from "./fmp-provider";
import type { NewsProvider } from "./provider.interface";

const log = logger.child("news:factory");

/**
 * Provider factory for news -- mirrors market-data/provider.ts and
 * fundamentals/provider.ts. Nothing outside this module should import a
 * concrete provider directly, and nothing outside service.ts should
 * import the singleton this factory produces.
 */
function createProvider(): NewsProvider {
  switch (env.NEWS_DATA_PROVIDER) {
    case "mock":
      log.info("using mock news provider (no real news configured)");
      return new MockNewsProvider();
    case "fmp":
      log.info("using Financial Modeling Prep news provider");
      return new FmpNewsProvider(env.FMP_API_KEY ?? "");
    default: {
      const exhaustive: never = env.NEWS_DATA_PROVIDER;
      throw new Error(`Unhandled news provider: ${exhaustive}`);
    }
  }
}

export const newsProvider: NewsProvider = createProvider();
