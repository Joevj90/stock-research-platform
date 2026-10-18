import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getHistoricalPrices } from "@/server/market-data/service";
import { evaluateTrendReset, TREND_RESET_MIN_BARS, type TrendResetEvaluation } from "@/lib/trend-reset";
import type { Result } from "@/lib/types";

const log = logger.child("watchlist");

/**
 * The watchlist, and the code-only Trend Reset check that runs over it.
 *
 * TWO HARD RULES, both of which exist for cost reasons and are enforced
 * structurally rather than by convention:
 *
 * 1. NOTHING IN THIS FILE CALLS ANTHROPIC. The watchlist check is pure
 *    arithmetic over price bars. There is no import of any agent or
 *    interpreter here, and there should never be one -- running the AI
 *    pipeline across a whole watchlist on every check would be the most
 *    expensive accidental action in the app. The AI analysis is a
 *    separate, explicitly per-stock action the user triggers from the
 *    existing pipeline.
 *
 * 2. THE WATCHLIST IS CAPPED. The market-data plan in use allows 250
 *    requests per DAY. One check costs one request per stock (served
 *    from a 12-hour cache after the first), so an uncapped watchlist
 *    could exhaust a day's budget in a single click and break the rest
 *    of the app until midnight.
 */

/** Chosen against the 250-requests-per-day limit: 25 stocks is at most
 * 25 requests per check, cached for 12 hours afterward, which leaves
 * the great majority of the daily budget for everything else. */
export const MAX_WATCHLIST_SIZE = 25;

/** Three years of daily bars. The deepest the strategy reaches back is
 * 220 trading days (the 200-day average plus the 20-day rising check),
 * so one year would technically do -- but it costs the same single
 * request either way, and a margin means a stock with a gap in its
 * history still evaluates instead of reporting "not enough data". */
const HISTORY_PERIOD = "3Y" as const;

/**
 * How many stocks to fetch at once, and how hard to retry.
 *
 * Measured against the live plan on 2026-10-17: a burst of 10
 * simultaneous requests came back with two HTTP 402s (PG and HD) while
 * the other eight succeeded. 402 is normally "your plan does not cover
 * this", but the plan plainly does cover these symbols -- the same
 * endpoint serves them fine on their own, and the two that failed were
 * ordinary large caps sitting between six that worked. So the 402 under
 * load is spurious, and without a retry roughly one watchlist row in
 * five would display "requires a paid plan" for a stock that is
 * perfectly available.
 *
 * Hence: fetch two at a time instead of four, and retry once. Both are
 * cheap -- the 12-hour cache means a warm check makes no requests at
 * all, and a retry only costs a request when the first attempt failed.
 */
const CHECK_CONCURRENCY = 2;
const FETCH_RETRIES = 1;
const RETRY_DELAY_MS = 500;

/** Failures worth a second attempt. A genuinely bad ticker returns
 * INVALID_TICKER and is not retried, so a typo still fails fast. */
const RETRYABLE_ERROR_CODES = new Set([
  "PROVIDER_PLAN_REQUIRED", // spurious under concurrency -- see above
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "NETWORK_ERROR",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches one stock's history, retrying once on the failures that
 * experience says are transient. */
async function fetchHistoryWithRetry(ticker: string) {
  let last = await getHistoricalPrices(ticker, HISTORY_PERIOD);

  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    if (last.ok) return last;
    if (!RETRYABLE_ERROR_CODES.has(last.error.code)) return last;

    log.warn("retrying watchlist price fetch", { ticker, code: last.error.code });
    await sleep(RETRY_DELAY_MS);
    last = await getHistoricalPrices(ticker, HISTORY_PERIOD);
  }

  return last;
}

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function normalizeTicker(raw: string): Result<string> {
  const ticker = raw.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Enter a ticker symbol." } };
  }
  if (!TICKER_PATTERN.test(ticker)) {
    return {
      ok: false,
      error: { code: "INVALID_TICKER", message: `"${raw}" doesn't look like a ticker symbol.` },
    };
  }
  return { ok: true, data: ticker };
}

export interface WatchlistEntry {
  id: string;
  ticker: string;
  companyName: string | null;
  notes: string | null;
  addedAt: string;
}

export interface WatchlistCheckRow extends WatchlistEntry {
  evaluation: TrendResetEvaluation;
  /** The most recent stored forecast for this ticker, if the AI
   * pipeline has ever been run on it. Read from the existing
   * predictions table -- never generated here. */
  latestForecast: {
    horizon: string;
    predictionDate: string;
    expectedReturnPct: number;
    aiRating: string;
    confidenceScore: number;
    priceAtPrediction: number;
  } | null;
  /** Set when the price data could not be fetched for this one stock.
   * One bad ticker must not fail the whole check. */
  error: string | null;
}

/**
 * Company names written while the app ran on the mock provider look like
 * "AAPL (mock -- name unknown)" and persist in the stocks table long
 * after the real provider takes over. Displaying one next to genuine
 * prices is actively harmful in both directions: it makes real data look
 * fabricated, and it trains the reader to ignore a "mock" label that in
 * other screens would be a true warning.
 *
 * So a mock-era name is treated as no name at all. The ticker is shown
 * on its own until something real replaces it.
 */
const MOCK_NAME_PATTERN = /\(mock\b/i;

function realCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  return MOCK_NAME_PATTERN.test(name) ? null : name;
}

function toEntry(row: {
  id: string;
  ticker: string;
  notes: string | null;
  addedAt: Date;
  stock: { name: string | null } | null;
}): WatchlistEntry {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: realCompanyName(row.stock?.name),
    notes: row.notes,
    addedAt: row.addedAt.toISOString(),
  };
}

export async function listWatchlist(): Promise<Result<WatchlistEntry[]>> {
  try {
    const rows = await prisma.watchlistItem.findMany({
      orderBy: { addedAt: "desc" },
      include: { stock: { select: { name: true } } },
    });
    return { ok: true, data: rows.map(toEntry) };
  } catch (err) {
    log.error("failed to list watchlist", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "DB_ERROR", message: "Could not read the watchlist." } };
  }
}

export async function addToWatchlist(rawTicker: string, notes?: string): Promise<Result<WatchlistEntry>> {
  const validation = normalizeTicker(rawTicker);
  if (!validation.ok) return validation;
  const ticker = validation.data;

  try {
    const existing = await prisma.watchlistItem.findUnique({ where: { ticker } });
    if (existing) {
      return { ok: false, error: { code: "ALREADY_ON_LIST", message: `${ticker} is already on the watchlist.` } };
    }

    const count = await prisma.watchlistItem.count();
    if (count >= MAX_WATCHLIST_SIZE) {
      return {
        ok: false,
        error: {
          code: "WATCHLIST_FULL",
          message:
            `The watchlist is capped at ${MAX_WATCHLIST_SIZE} stocks. ` +
            `That cap exists because the market-data plan allows 250 requests a day and each check costs one per stock. ` +
            `Remove something before adding more.`,
        },
      };
    }

    const stock = await prisma.stock.upsert({ where: { ticker }, update: {}, create: { ticker } });
    const row = await prisma.watchlistItem.create({
      data: { ticker, notes: notes?.trim() || null, stockId: stock.id },
      include: { stock: { select: { name: true } } },
    });

    log.info("added to watchlist", { ticker });
    return { ok: true, data: toEntry(row) };
  } catch (err) {
    log.error("failed to add to watchlist", { ticker, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "DB_ERROR", message: `Could not add ${ticker}.` } };
  }
}

export async function removeFromWatchlist(id: string): Promise<Result<{ id: string }>> {
  try {
    await prisma.watchlistItem.delete({ where: { id } });
    return { ok: true, data: { id } };
  } catch (err) {
    log.warn("failed to remove from watchlist", { id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "NOT_FOUND", message: "That stock is not on the watchlist." } };
  }
}

export async function updateWatchlistNotes(id: string, notes: string): Promise<Result<WatchlistEntry>> {
  try {
    const row = await prisma.watchlistItem.update({
      where: { id },
      data: { notes: notes.trim() || null },
      include: { stock: { select: { name: true } } },
    });
    return { ok: true, data: toEntry(row) };
  } catch (err) {
    log.warn("failed to update notes", { id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "NOT_FOUND", message: "That stock is not on the watchlist." } };
  }
}

/** The latest stored forecast, if the AI pipeline has ever run on this
 * ticker. Read-only: this function never triggers an analysis. */
async function latestForecastFor(ticker: string): Promise<WatchlistCheckRow["latestForecast"]> {
  try {
    const row = await prisma.prediction.findFirst({
      where: { ticker },
      orderBy: { predictionDate: "desc" },
      select: {
        horizon: true,
        predictionDate: true,
        expectedReturnPct: true,
        aiRating: true,
        confidenceScore: true,
        priceAtPrediction: true,
      },
    });
    if (!row) return null;
    return {
      horizon: row.horizon,
      predictionDate: row.predictionDate.toISOString(),
      expectedReturnPct: row.expectedReturnPct,
      aiRating: row.aiRating,
      confidenceScore: row.confidenceScore,
      priceAtPrediction: row.priceAtPrediction,
    };
  } catch {
    // A missing forecast is normal and must never fail the check.
    return null;
  }
}

async function checkOne(entry: WatchlistEntry): Promise<WatchlistCheckRow> {
  const [history, latestForecast] = await Promise.all([
    fetchHistoryWithRetry(entry.ticker),
    latestForecastFor(entry.ticker),
  ]);

  if (!history.ok) {
    // Say plainly when a failure is the known flaky one, so a spurious
    // 402 is not read as "upgrade your plan".
    const message =
      history.error.code === "PROVIDER_PLAN_REQUIRED"
        ? `The data provider refused this request twice. This is usually temporary rather than a real plan limit — try the check again in a moment.`
        : history.error.message;

    return {
      ...entry,
      evaluation: evaluateTrendReset([]),
      latestForecast,
      error: message,
    };
  }

  const evaluation = evaluateTrendReset(history.data);

  return {
    ...entry,
    evaluation,
    latestForecast,
    error: evaluation.insufficientData
      ? `Only ${history.data.length} days of price history available; ${TREND_RESET_MIN_BARS} are needed.`
      : null,
  };
}

export interface WatchlistCheckResult {
  checkedAt: string;
  rows: WatchlistCheckRow[];
  qualifyingCount: number;
  /** Requests this check could have cost. Shown in the UI so the daily
   * budget stays visible rather than being something to find out about
   * when the rest of the app starts failing. */
  marketDataRequestsUsed: number;
}

/**
 * Runs the Trend Reset check across the whole watchlist. Code only --
 * no AI, no writes beyond the market-data cache the price fetch
 * maintains. A single stock failing (bad ticker, provider hiccup)
 * reports its own error and leaves the rest of the check intact.
 */
export async function checkWatchlist(): Promise<Result<WatchlistCheckResult>> {
  const listed = await listWatchlist();
  if (!listed.ok) return listed;

  const entries = listed.data;
  const rows: WatchlistCheckRow[] = [];

  for (let i = 0; i < entries.length; i += CHECK_CONCURRENCY) {
    const batch = entries.slice(i, i + CHECK_CONCURRENCY);
    const settled = await Promise.all(batch.map(checkOne));
    rows.push(...settled);
  }

  // Keep qualifying stocks at the top, then by how many conditions they
  // met, so the list reads in order of interest rather than by date.
  rows.sort((a, b) => {
    if (a.evaluation.qualifies !== b.evaluation.qualifies) return a.evaluation.qualifies ? -1 : 1;
    const aPassed = a.evaluation.conditions.filter((c) => c.passed).length;
    const bPassed = b.evaluation.conditions.filter((c) => c.passed).length;
    if (aPassed !== bPassed) return bPassed - aPassed;
    return a.ticker < b.ticker ? -1 : 1;
  });

  log.info("watchlist checked", { count: rows.length, qualifying: rows.filter((r) => r.evaluation.qualifies).length });

  return {
    ok: true,
    data: {
      checkedAt: new Date().toISOString(),
      rows,
      qualifyingCount: rows.filter((r) => r.evaluation.qualifies).length,
      marketDataRequestsUsed: entries.length,
    },
  };
}
