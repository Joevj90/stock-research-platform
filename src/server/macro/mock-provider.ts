import type { MacroDataProvider } from "./provider.interface";
import type { MacroIndicator } from "@/lib/macro-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("macro:mock");

/**
 * MOCK macro data provider -- NOT real economic data. Returns plausible
 * but clearly-labeled placeholder figures (source name says "Mock", no
 * real URL) so the Macro Analysis Agent is fully exercisable without a
 * real API key, following the same convention as every other mock
 * provider in this app.
 */
export class MockMacroDataProvider implements MacroDataProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

  async getIndicators(): Promise<Result<MacroIndicator[]>> {
    const now = new Date().toISOString();
    const indicators: MacroIndicator[] = [
      { name: "GDP", label: "GDP Growth", value: 2.4, unit: "%", asOfDate: now, source: "Mock Economic Data (not real)", url: null, retrievedAt: now },
      { name: "CPI", label: "Inflation (CPI)", value: 3.1, unit: "%", asOfDate: now, source: "Mock Economic Data (not real)", url: null, retrievedAt: now },
      { name: "unemploymentRate", label: "Unemployment Rate", value: 4.2, unit: "%", asOfDate: now, source: "Mock Economic Data (not real)", url: null, retrievedAt: now },
      { name: "treasury10Year", label: "10-Year Treasury Yield", value: 4.3, unit: "%", asOfDate: now, source: "Mock Economic Data (not real)", url: null, retrievedAt: now },
    ];

    log.debug("generated mock macro indicators");
    return { ok: true, data: indicators };
  }
}
