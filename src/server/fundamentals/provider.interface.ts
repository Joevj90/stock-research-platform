import type { FinancialPeriod, FinancialPeriodType } from "@/lib/fundamentals-types";
import type { Result } from "@/lib/types";

/**
 * Contract every fundamentals provider must satisfy. Mirrors
 * src/server/market-data/provider.interface.ts on purpose -- same shape
 * of boundary, same reasoning: nothing outside this module should know
 * or care which concrete implementation is in use, and only
 * service.ts is allowed to call it directly.
 */
export interface FundamentalsProvider {
  readonly id: "mock" | "fmp";
  readonly isMock: boolean;

  /** Returns up to `limit` reporting periods, most recent first, already
   * normalized to this app's FinancialPeriod shape. */
  getFinancials(
    ticker: string,
    periodType: FinancialPeriodType,
    limit: number
  ): Promise<Result<FinancialPeriod[]>>;
}
