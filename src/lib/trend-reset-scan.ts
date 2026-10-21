import type { PriceBar } from "@/lib/types";
import { type ConditionResult, evaluateTrendReset } from "@/lib/trend-reset";

/**
 * Turns a batch of price histories into Trend Reset scan rows.
 *
 * Pure arithmetic, no I/O: the same evaluateTrendReset the watchlist uses
 * (which a cross-check test ties to the validated backtest), applied to
 * many stocks at once. Only stocks meeting all four conditions, or three
 * of four, are kept as rows -- a 500-row table of failures helps nobody.
 */

export interface ScanRow {
  ticker: string;
  qualifies: boolean;
  conditionsMet: number;
  price: number;
  sma200: number;
  pctAboveSma: number;
  roc63Pct: number;
  maxRoc63PriorPct: number;
  asOfDate: string;
  conditions: ConditionResult[];
}

export interface ScanSkip {
  ticker: string;
  reason: string;
}

export interface BatchScan {
  rows: ScanRow[];
  skipped: ScanSkip[];
  /** Stocks evaluated (qualifying or not). */
  evaluated: number;
}

/** A stock whose newest bar is this many calendar days older than the
 * newest bar in the batch has stopped trading (taken over, delisted) and
 * is reported as skipped, not evaluated on stale prices. */
const STALE_DAYS = 7;

export function scanHistories(tickers: string[], histories: Map<string, PriceBar[]>): BatchScan {
  const rows: ScanRow[] = [];
  const skipped: ScanSkip[] = [];
  let evaluated = 0;

  let newest = "";
  for (const bars of histories.values()) {
    const last = bars[bars.length - 1]?.timestamp ?? "";
    if (last > newest) newest = last;
  }
  const staleBefore = newest ? new Date(Date.parse(newest) - STALE_DAYS * 86_400_000).toISOString() : "";

  for (const raw of tickers) {
    const ticker = raw.toUpperCase();
    const bars = histories.get(ticker);
    if (!bars || bars.length === 0) {
      skipped.push({ ticker, reason: "no price data" });
      continue;
    }
    if (bars[bars.length - 1]!.timestamp < staleBefore) {
      skipped.push({ ticker, reason: "no recent prices (possibly delisted or acquired)" });
      continue;
    }
    const e = evaluateTrendReset(bars);
    if (e.insufficientData || e.currentPrice === null || e.sma200 === null) {
      skipped.push({ ticker, reason: `not enough history (${bars.length} days)` });
      continue;
    }
    evaluated++;
    const met = e.conditions.filter((c) => c.passed).length;
    if (met < 3) continue;
    rows.push({
      ticker,
      qualifies: e.qualifies,
      conditionsMet: met,
      price: e.currentPrice,
      sma200: e.sma200,
      pctAboveSma: e.pctAboveSma ?? 0,
      roc63Pct: e.roc63Pct ?? 0,
      maxRoc63PriorPct: e.maxRoc63PriorPct ?? 0,
      asOfDate: e.asOfDate ?? bars[bars.length - 1]!.timestamp.slice(0, 10),
      conditions: e.conditions,
    });
  }
  return { rows, skipped, evaluated };
}

/** Qualifying stocks first, then close calls; within each, the one whose
 * 63-day change sits closest to zero (the most complete "reset") first. */
export function sortScanRows(rows: ScanRow[]): ScanRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.qualifies) - Number(a.qualifies) ||
      b.conditionsMet - a.conditionsMet ||
      Math.abs(a.roc63Pct) - Math.abs(b.roc63Pct) ||
      a.ticker.localeCompare(b.ticker),
  );
}
