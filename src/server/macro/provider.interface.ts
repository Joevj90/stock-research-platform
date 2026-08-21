import type { MacroIndicator } from "@/lib/macro-types";
import type { Result } from "@/lib/types";

/**
 * Contract every macro-data provider must satisfy. Mirrors
 * src/server/market-data/provider.interface.ts and siblings: nothing
 * outside this module should know or care which concrete implementation
 * is in use, and only service.ts is allowed to call it directly.
 *
 * Unlike every other provider in this app, this one is NOT ticker-scoped
 * -- economic indicators are the same for every company, so there's a
 * single `getIndicators()` rather than a per-ticker method.
 */
export interface MacroDataProvider {
  readonly id: "mock" | "fmp";
  readonly isMock: boolean;

  getIndicators(): Promise<Result<MacroIndicator[]>>;
}
