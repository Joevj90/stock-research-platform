import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getDailyHistoryBatch } from "@/server/market-data/service";
import { SP500_TICKERS } from "@/data/sp500-tickers";
import { type ScanRow, type ScanSkip, scanHistories, sortScanRows } from "@/lib/trend-reset-scan";
import type { PriceBar, Result } from "@/lib/types";

const log = logger.child("suggestions");

/**
 * Trend Reset suggestions: the S&P 500 checked against the four rules.
 *
 * CODE ONLY, like the watchlist check. No agent is imported here and no
 * AI call is made; a structural test enforces that. (An earlier S&P 500
 * screener that called the AI per stock cost about $15 a day and was
 * removed. This one costs nothing but free market-data requests.)
 *
 * The scan runs in batches of BATCH_SIZE stocks, one HTTP request each,
 * driven by the page, so no single request approaches the hosting plan's
 * time limit. Each batch is about two market-data requests.
 */

export const BATCH_SIZE = 50;
/** ~280 trading days: the deepest the rules reach back is 220. */
const HISTORY_CALENDAR_DAYS = 420;

export function totalBatches(): number {
  return Math.ceil(SP500_TICKERS.length / BATCH_SIZE);
}

export interface ScanSummary {
  id: string;
  startedAt: string;
  completedAt: string | null;
  totalBatches: number;
  batchesDone: number;
  asOfDate: string | null;
  universeSize: number;
  evaluated: number;
  rows: ScanRow[];
  skipped: ScanSkip[];
}

interface ScanRecord {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  totalBatches: number;
  batchesDone: number;
  asOfDate: string | null;
  evaluated: number;
  rowsJson: string;
  skippedJson: string;
}

function toSummary(r: ScanRecord): ScanSummary {
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    totalBatches: r.totalBatches,
    batchesDone: r.batchesDone,
    asOfDate: r.asOfDate,
    universeSize: SP500_TICKERS.length,
    evaluated: r.evaluated,
    rows: sortScanRows(JSON.parse(r.rowsJson) as ScanRow[]),
    skipped: JSON.parse(r.skippedJson) as ScanSkip[],
  };
}

export async function startScan(): Promise<Result<{ id: string; totalBatches: number }>> {
  try {
    const row = await prisma.trendResetScan.create({ data: { totalBatches: totalBatches() } });
    return { ok: true, data: { id: row.id, totalBatches: row.totalBatches } };
  } catch (err) {
    log.error("failed to start scan", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "DB_ERROR", message: "Could not start the scan." } };
  }
}

/**
 * Fetch a batch's histories. If the provider rejects the whole list
 * (one odd symbol in a stale index list can do that), split it in half
 * and try each half, down to single tickers, so one bad symbol costs
 * itself and not its 49 neighbours.
 */
async function fetchWithSplit(
  tickers: string[],
  out: Map<string, PriceBar[]>,
  failed: ScanSkip[],
): Promise<Result<true>> {
  const r = await getDailyHistoryBatch(tickers, HISTORY_CALENDAR_DAYS);
  if (r.ok) {
    for (const [k, v] of r.data) out.set(k, v);
    return { ok: true, data: true };
  }
  if (r.error.code === "PROVIDER_UNSUPPORTED" || r.error.code === "PROVIDER_AUTH_ERROR") return r;
  if (tickers.length === 1) {
    failed.push({ ticker: tickers[0]!.toUpperCase(), reason: r.error.message });
    return { ok: true, data: true };
  }
  const mid = Math.ceil(tickers.length / 2);
  const a = await fetchWithSplit(tickers.slice(0, mid), out, failed);
  if (!a.ok) return a;
  return fetchWithSplit(tickers.slice(mid), out, failed);
}

export async function runScanBatch(scanId: string, batch: number): Promise<Result<ScanSummary>> {
  const total = totalBatches();
  if (!Number.isInteger(batch) || batch < 0 || batch >= total) {
    return { ok: false, error: { code: "BAD_REQUEST", message: `Batch must be 0-${total - 1}.` } };
  }
  const tickers = SP500_TICKERS.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

  const histories = new Map<string, PriceBar[]>();
  const fetchFailures: ScanSkip[] = [];
  const fetched = await fetchWithSplit(tickers, histories, fetchFailures);
  if (!fetched.ok) return fetched;

  const failedSet = new Set(fetchFailures.map((f) => f.ticker));
  const result = scanHistories(
    tickers.filter((t) => !failedSet.has(t.toUpperCase())),
    histories,
  );
  const batchAsOf = result.rows.map((r) => r.asOfDate).sort().pop() ?? null;

  try {
    // Read-merge-write. Batches come one at a time from the page, so
    // there is no concurrent writer to race.
    const current = await prisma.trendResetScan.findUnique({ where: { id: scanId } });
    if (!current) return { ok: false, error: { code: "NOT_FOUND", message: "That scan no longer exists." } };
    const rows = [...(JSON.parse(current.rowsJson) as ScanRow[]), ...result.rows];
    const skipped = [...(JSON.parse(current.skippedJson) as ScanSkip[]), ...fetchFailures, ...result.skipped];
    const batchesDone = current.batchesDone + 1;
    const asOfDate = [current.asOfDate, batchAsOf].filter((d): d is string => !!d).sort().pop() ?? null;
    const updated = await prisma.trendResetScan.update({
      where: { id: scanId },
      data: {
        rowsJson: JSON.stringify(rows),
        skippedJson: JSON.stringify(skipped),
        batchesDone,
        evaluated: current.evaluated + result.evaluated,
        asOfDate,
        completedAt: batchesDone >= current.totalBatches ? new Date() : null,
      },
    });
    log.info("scan batch done", { scanId, batch, qualifying: result.rows.filter((r) => r.qualifies).length });
    return { ok: true, data: toSummary(updated) };
  } catch (err) {
    log.error("failed to save scan batch", { scanId, batch, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "DB_ERROR", message: "Could not save the scan results." } };
  }
}

/** The most recent COMPLETED scan, or null if none has finished yet. */
export async function getLatestScan(): Promise<Result<ScanSummary | null>> {
  try {
    const row = await prisma.trendResetScan.findFirst({
      where: { completedAt: { not: null } },
      orderBy: { startedAt: "desc" },
    });
    return { ok: true, data: row ? toSummary(row) : null };
  } catch (err) {
    log.error("failed to read latest scan", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "DB_ERROR", message: "Could not load the last scan." } };
  }
}
