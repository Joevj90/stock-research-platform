import type { InsiderTransaction } from "@/lib/insider-trading-types";
import type { Result } from "@/lib/types";

/**
 * Contract every insider-trading provider must satisfy. Mirrors
 * src/server/news/provider.interface.ts: nothing outside this module
 * should know or care which concrete implementation is in use, and only
 * service.ts is allowed to call it directly.
 */
export interface InsiderTradingProvider {
  readonly id: "mock" | "fmp";
  readonly isMock: boolean;

  getInsiderTransactions(ticker: string, limit: number): Promise<Result<InsiderTransaction[]>>;
}
