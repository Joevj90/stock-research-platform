import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { InsiderTransaction, InsiderTransactionType } from "@/lib/insider-trading-types";
import { insiderTradingProvider } from "./provider";
import { INSIDER_TRADING_CACHE_TTL_MS, isFresh } from "./cache";

const log = logger.child("insider-trading:service");

const FETCH_LIMIT = 30;

/**
 * ⚠️ ARCHITECTURAL BOUNDARY ⚠️ -- same pattern as market-data/service.ts,
 * fundamentals/service.ts, and news/service.ts: the only file allowed to
 * import `insiderTradingProvider` or touch the database for insider
 * trading data.
 */
export async function getInsiderTransactions(rawTicker: string): Promise<Result<InsiderTransaction[]>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  try {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker },
    });

    const cacheEntry = await prisma.insiderTradingCacheEntry.findUnique({ where: { stockId: stock.id } });

    if (
      cacheEntry &&
      cacheEntry.provider === insiderTradingProvider.id &&
      isFresh(cacheEntry.retrievedAt, INSIDER_TRADING_CACHE_TTL_MS)
    ) {
      const rows = await prisma.insiderTransaction.findMany({
        where: { stockId: stock.id },
        orderBy: { transactionDate: "desc" },
        take: FETCH_LIMIT,
      });
      if (rows.length > 0) {
        log.debug("insider trading cache hit", { ticker });
        return { ok: true, data: rows.map((r: InsiderTransactionRow) => rowToTransaction(r, ticker)) };
      }
    }

    log.debug("insider trading cache miss — calling provider", { ticker });
    const result = await insiderTradingProvider.getInsiderTransactions(ticker, FETCH_LIMIT);
    if (!result.ok) return result;

    const transactions = result.data;

    await prisma.$transaction([
      ...transactions.map((t) =>
        prisma.insiderTransaction.upsert({
          where: {
            stockId_reportingName_transactionDate_shares_transactionType: {
              stockId: stock.id,
              reportingName: t.reportingName,
              transactionDate: new Date(t.transactionDate),
              shares: t.shares,
              transactionType: t.transactionType,
            },
          },
          update: {
            role: t.role,
            filingDate: new Date(t.filingDate),
            pricePerShare: t.pricePerShare,
            url: t.url,
            provider: insiderTradingProvider.id,
            retrievedAt: new Date(),
          },
          create: {
            stockId: stock.id,
            reportingName: t.reportingName,
            role: t.role,
            transactionType: t.transactionType,
            transactionDate: new Date(t.transactionDate),
            filingDate: new Date(t.filingDate),
            shares: t.shares,
            pricePerShare: t.pricePerShare,
            url: t.url,
            provider: insiderTradingProvider.id,
          },
        })
      ),
      prisma.insiderTradingCacheEntry.upsert({
        where: { stockId: stock.id },
        update: { provider: insiderTradingProvider.id, retrievedAt: new Date() },
        create: { stockId: stock.id, provider: insiderTradingProvider.id },
      }),
    ]);

    return { ok: true, data: transactions };
  } catch (err) {
    log.error("getInsiderTransactions failed", { ticker, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to fetch insider trading data." } };
  }
}

interface InsiderTransactionRow {
  reportingName: string;
  role: string | null;
  transactionType: string;
  transactionDate: Date;
  filingDate: Date;
  shares: number;
  pricePerShare: number | null;
  url: string | null;
  provider: string;
  retrievedAt: Date;
}

function rowToTransaction(row: InsiderTransactionRow, ticker: string): InsiderTransaction {
  return {
    ticker,
    reportingName: row.reportingName,
    role: row.role,
    transactionType: row.transactionType as InsiderTransactionType,
    transactionDate: row.transactionDate.toISOString(),
    filingDate: row.filingDate.toISOString(),
    shares: row.shares,
    pricePerShare: row.pricePerShare,
    url: row.url,
    provider: row.provider,
    retrievedAt: row.retrievedAt.toISOString(),
  };
}
