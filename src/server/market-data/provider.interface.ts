import type { PriceBar, Quote, Result } from "@/lib/types";

/**
 * Contract every market-data provider (mock, Alpha Vantage, Finnhub, ...)
 * must satisfy. Nothing outside this module should know or care which
 * concrete implementation is in use — see `index.ts` for the factory.
 */
export interface MarketDataProvider {
  readonly id: "mock" | "alpha_vantage" | "finnhub";
  readonly isMock: boolean;

  /** Basic identity lookup — validates the ticker exists for this provider. */
  getCompanyName(ticker: string): Promise<Result<string>>;

  /** Latest quote for a ticker. */
  getQuote(ticker: string): Promise<Result<Quote>>;

  /** Historical daily OHLCV bars, most recent last. */
  getHistory(ticker: string, days: number): Promise<Result<PriceBar[]>>;
}
