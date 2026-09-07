/**
 * Valuation Screener domain types.
 *
 * Two-phase scan, mirroring the "combine evidence, control cost" pattern
 * used elsewhere in this app (e.g. shared analysis gathering):
 *
 *   PHASE 1 (all ~500 S&P 500 tickers, no AI, cheap): rank every ticker
 *   by how far its current price sits below its own real, deterministic
 *   DCF base-case fair value -- reusing the exact same DCF math the
 *   Valuation Engine (Step 8) already uses, just without that step's
 *   historical/peer comparison or AI interpretation layer, since neither
 *   is needed to rank candidates.
 *
 *   PHASE 2 (only the shortlist that clears Phase 1, real AI): runs the
 *   existing Forecasting Agent (Step 14) -- unmodified, the exact same
 *   function a single "Analyze Stock" run uses -- on each shortlisted
 *   ticker, and reads its real 1-month horizon expected return. This is
 *   the only place any AI cost is spent in a scan, and it costs roughly
 *   one Forecasting Agent run (an 8-agent gather plus one synthesis
 *   call) per shortlisted ticker -- the same as clicking "Analyze Stock"
 *   that many times, not 500 times.
 *
 * FACT / CALCULATION / FORECAST, mapped:
 *   - FACT        = each ticker's real fetched quote and financial
 *                    statements (never re-derived).
 *   - CALCULATION = ValuationGapCandidate.impliedUpsidePct -- pure DCF
 *                    arithmetic, identical formula to the Valuation
 *                    Engine's own dcf.ts, never asked of an LLM.
 *   - FORECAST    = ScreenerHit's expectedReturnPct -- the Forecasting
 *                    Agent's real 1-month scenario output, reused
 *                    verbatim, never recalculated here.
 */

/** One ticker's result from the cheap, no-AI Phase 1 valuation scan. */
export interface ValuationGapCandidate {
  ticker: string;
  currentPrice: number;
  /** Real DCF base-case fair value per share, or null if the company's
   * financials didn't support computing one (e.g. negative revenue,
   * missing shares-outstanding derivation) -- never a guessed number. */
  baseFairValue: number | null;
  /** (baseFairValue - currentPrice) / currentPrice * 100 -- positive
   * means the DCF base case thinks the stock is undervalued (upside);
   * same formula as DcfScenario.impliedUpsideDownsidePct in the
   * Valuation Engine, computed by the exact same function. Null when
   * baseFairValue is null. */
  impliedUpsidePct: number | null;
}

/** One chunk's worth of Phase 1 progress, as the client pages through
 * the full S&P 500 list in batches to stay under each request's time
 * budget. */
export interface ValuationScanChunkResult {
  candidates: ValuationGapCandidate[];
  /** Tickers in this chunk that failed to fetch/compute -- skipped, not
   * silently dropped, so the UI can be honest about coverage. */
  failedTickers: string[];
}

/** One ticker that cleared Phase 1 and was run through the real
 * Forecasting Agent in Phase 2, reporting its real 1-month horizon. */
export interface ScreenerHit {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  expectedPrice: number;
  expectedReturnPct: number; // the Forecasting Agent's real 1-month figure
  confidenceScore: number; // the Forecasting Agent's real overall confidence
  dataSupportsThisHorizon: boolean;
  limitationNote: string | null;
  impliedUpsidePct: number | null; // carried over from Phase 1, for context
}
