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
  asOf: string; // ISO 8601
}

export type DataProviderId = "mock" | "alpha_vantage" | "finnhub";

/**
 * Every payload the market-data layer returns is tagged with provenance so
 * the UI (and later, AI agents) can tell real data from placeholder data
 * and never silently treat mock output as a real market signal.
 */
export interface Provenance {
  provider: DataProviderId;
  isMock: boolean;
  fetchedAt: string; // ISO 8601
}

export interface StockSnapshot {
  ticker: string;
  companyName: string;
  quote: Quote;
  history: PriceBar[];
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
