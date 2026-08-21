import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { MockMacroDataProvider } from "./mock-provider";
import { FmpMacroDataProvider } from "./fmp-provider";
import type { MacroDataProvider } from "./provider.interface";

const log = logger.child("macro:factory");

function createProvider(): MacroDataProvider {
  switch (env.MACRO_DATA_PROVIDER) {
    case "mock":
      log.info("using mock macro data provider (no real economic data configured)");
      return new MockMacroDataProvider();
    case "fmp":
      log.info("using Financial Modeling Prep macro data provider");
      return new FmpMacroDataProvider(env.FMP_API_KEY ?? "");
    default: {
      const exhaustive: never = env.MACRO_DATA_PROVIDER;
      throw new Error(`Unhandled macro data provider: ${exhaustive}`);
    }
  }
}

export const macroDataProvider: MacroDataProvider = createProvider();
