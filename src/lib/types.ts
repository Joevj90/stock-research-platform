/**
 * Shared domain types. These are the contracts that let the UI, the
 * market-data module, and the (future) AI analysis module evolve
 * independently as long as they agree on these shapes.
 */

export interface PriceBar {
  timestamp: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  volume: number;
  marketCap: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVolume: number | null;
  asOf: string; // ISO 8601
}

export type DataProviderId = "mock" | "fmp" | "alpha_vantage" | "finnhub";

/**
 * The supported historical lookback windows. This is the single source of
 * truth for "period" everywhere in the app — the UI period selector, the
 * API's ?period= query param, and the market-data cache all key off this
 * type, so adding a new window later means extending one map, not hunting
 * down every place a window was hardcoded.
 */
export type HistoricalPeriod = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export const HISTORICAL_PERIODS: HistoricalPeriod[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y"];

/** Approximate calendar days to look back for each period (used to compute
 * the from/to date range sent to the provider). Deliberately calendar days,
 * not trading days — providers accept a date range and return whatever
 * trading days fall inside it. */
export const PERIOD_TO_DAYS: Record<HistoricalPeriod, number> = {
  "1M": 31,
  "3M": 93,
  "6M": 186,
  "1Y": 366,
  "3Y": 3 * 366,
  "5Y": 5 * 366,
};

/**
 * Every payload the market-data layer returns is tagged with provenance so
 * the UI (and later, AI agents) can tell real data from placeholder data
 * and never silently treat mock output as a real market signal.
 */
export interface Provenance {
  provider: DataProviderId;
  isMock: boolean;
  fetchedAt: string; // ISO 8601
  /** True if this response was served from the local cache/DB rather than
   * a fresh call to the external provider. */
  fromCache: boolean;
}

export interface StockSnapshot {
  ticker: string;
  companyName: string;
  quote: Quote;
  history: PriceBar[];
  period: HistoricalPeriod;
  provenance: Provenance;
}

/**
 * Result wrapper used throughout the server layer instead of throwing for
 * expected failure modes (bad ticker, provider unavailable, rate limited).
 * Callers get a typed discriminated union instead of a try/catch.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Contract for a future AI analyst agent's output. Not produced in Phase 1
 * — defined now so the API route and DB schema have a stable shape to
 * target when the AI analysis phases are implemented.
 */
export interface AnalystOutput {
  agentName: string;
  kind: "analyst" | "committee" | "devils_advocate" | "final_report";
  summary: string;
  confidence: number; // 0..1
  citations: { title: string; url?: string }[];
}
