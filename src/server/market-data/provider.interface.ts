import type { DataProviderId, PriceBar, Quote, Result } from "@/lib/types";

/**
 * Contract every market-data provider (mock, FMP, Alpha Vantage, Finnhub,
 * ...) must satisfy. Nothing outside this module should know or care which
 * concrete implementation is in use — see `index.ts` for the factory, and
 * `service.ts` for the only layer allowed to call a provider directly.
 */
export interface MarketDataProvider {
  readonly id: DataProviderId;
  readonly isMock: boolean;

  /** Basic identity lookup — validates the ticker exists for this provider. */
  getCompanyName(ticker: string): Promise<Result<string>>;

  /** Latest quote, including fundamentals (market cap, 52-week high/low,
   * average volume) where the provider supplies them. */
  getQuote(ticker: string): Promise<Result<Quote>>;

  /** Daily OHLCV bars for the given calendar date range (inclusive),
   * oldest first. The caller (the market-data service) is responsible for
   * turning a HistoricalPeriod into a concrete date range — providers only
   * deal in dates, never in the app's period vocabulary, so a provider
   * swap never has to know what "1Y" means. */
  getHistory(ticker: string, from: Date, to: Date): Promise<Result<PriceBar[]>>;

  /** Up to `limit` peer/competitor ticker symbols for comparison purposes
   * (same sector/exchange/market-cap range, as defined by the provider).
   * Added for the Valuation Engine's peer comparison — returns real
   * tickers only, never invented ones. */
  getPeerSymbols(ticker: string, limit: number): Promise<Result<string[]>>;
}
