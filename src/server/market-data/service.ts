import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { HistoricalPeriod, PriceBar, Quote, Result, StockSnapshot } from "@/lib/types";
import { marketDataProvider } from "./provider";
import {
  HISTORICAL_CACHE_TTL_MS,
  QUOTE_CACHE_PERIOD,
  QUOTE_CACHE_TTL_MS,
  isFresh,
  periodToRange,
} from "./cache";

const log = logger.child("market-data:service");

/**
 * ⚠️ ARCHITECTURAL BOUNDARY ⚠️
 *
 * This file is the ONLY place in the app that is allowed to import and call
 * `marketDataProvider` (see ./provider — deliberately not re-exported from
 * the module's index barrel). Every other layer — API routes, server
 * components, and especially the AI analysis module once it's built — must
 * go through the functions exported here (`getQuote`, `getHistoricalPrices`,
 * `getStockSnapshot`).
 *
 * Concretely, this enforces:
 *   UI → Backend (API routes / server components) → Market Data Service → Provider
 * and rules out:
 *   UI → AI → Provider
 *
 * Why this matters in practice: it's the one place that (a) knows how to
 * turn a period into a date range, (b) decides cache hit vs. miss, and
 * (c) persists what it fetches with provenance. An AI agent calling the
 * provider directly would bypass all three — silently burning rate-limit
 * budget, skipping the DB history, and losing the source/timestamp record
 * that this app's provenance requirements depend on.
 */

/** Fetches (and caches) the latest quote for a ticker, including
 * fundamentals (market cap, 52-week high/low, average volume). */
export async function getQuote(rawTicker: string): Promise<Result<Quote>> {
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

    const cacheEntry = await prisma.marketDataCacheEntry.findUnique({
      where: {
        stockId_dataType_period: { stockId: stock.id, dataType: "quote", period: QUOTE_CACHE_PERIOD },
      },
    });

    if (cacheEntry && cacheEntry.provider === marketDataProvider.id && isFresh(cacheEntry.retrievedAt, QUOTE_CACHE_TTL_MS)) {
      const cached = await prisma.quote.findFirst({
        where: { stockId: stock.id },
        orderBy: { retrievedAt: "desc" },
      });
      if (cached) {
        log.debug("quote cache hit", { ticker });
        return { ok: true, data: toQuote(ticker, cached) };
      }
    }

    log.debug("quote cache miss — calling provider", { ticker });
    const result = await marketDataProvider.getQuote(ticker);
    if (!result.ok) return result;

    const q = result.data;
    await prisma.$transaction([
      prisma.quote.create({
        data: {
          stockId: stock.id,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          previousClose: q.previousClose,
          volume: q.volume,
          marketCap: q.marketCap,
          week52High: q.week52High,
          week52Low: q.week52Low,
          avgVolume: q.avgVolume,
          provider: marketDataProvider.id,
        },
      }),
      prisma.marketDataCacheEntry.upsert({
        where: {
          stockId_dataType_period: { stockId: stock.id, dataType: "quote", period: QUOTE_CACHE_PERIOD },
        },
        update: { provider: marketDataProvider.id, retrievedAt: new Date() },
        create: {
          stockId: stock.id,
          dataType: "quote",
          period: QUOTE_CACHE_PERIOD,
          provider: marketDataProvider.id,
        },
      }),
    ]);

    return { ok: true, data: q };
  } catch (err) {
    return internalError("getQuote", ticker, err);
  }
}

/** Fetches (and caches) daily OHLCV history for a ticker over one of the
 * supported lookback periods (1M, 3M, 6M, 1Y, 3Y, 5Y). */
export async function getHistoricalPrices(
  rawTicker: string,
  period: HistoricalPeriod
): Promise<Result<PriceBar[]>> {
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

    const { from, to } = periodToRange(period);

    const cacheEntry = await prisma.marketDataCacheEntry.findUnique({
      where: { stockId_dataType_period: { stockId: stock.id, dataType: "historical", period } },
    });

    if (cacheEntry && cacheEntry.provider === marketDataProvider.id && isFresh(cacheEntry.retrievedAt, HISTORICAL_CACHE_TTL_MS)) {
      const bars = await prisma.priceBar.findMany({
        where: { stockId: stock.id, interval: "1d", timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: "asc" },
      });
      if (bars.length > 0) {
        log.debug("historical cache hit", { ticker, period, bars: bars.length });
        return { ok: true, data: bars.map(toPriceBar) };
      }
    }

    log.debug("historical cache miss — calling provider", { ticker, period });
    const result = await marketDataProvider.getHistory(ticker, from, to);
    if (!result.ok) return result;

    const bars = result.data;

    await prisma.$transaction([
      ...bars.map((bar) =>
        prisma.priceBar.upsert({
          where: {
            stockId_timestamp_interval: {
              stockId: stock.id,
              timestamp: new Date(bar.timestamp),
              interval: "1d",
            },
          },
          update: {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            provider: marketDataProvider.id,
            retrievedAt: new Date(),
          },
          create: {
            stockId: stock.id,
            timestamp: new Date(bar.timestamp),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            interval: "1d",
            provider: marketDataProvider.id,
          },
        })
      ),
      prisma.marketDataCacheEntry.upsert({
        where: { stockId_dataType_period: { stockId: stock.id, dataType: "historical", period } },
        update: { provider: marketDataProvider.id, retrievedAt: new Date(), rangeStart: from, rangeEnd: to },
        create: {
          stockId: stock.id,
          dataType: "historical",
          period,
          provider: marketDataProvider.id,
          rangeStart: from,
          rangeEnd: to,
        },
      }),
    ]);

    return { ok: true, data: bars };
  } catch (err) {
    return internalError("getHistoricalPrices", ticker, err);
  }
}

/** Convenience composite used by the dashboard: quote + history + company
 * name + provenance in one call. */
export async function getStockSnapshot(
  rawTicker: string,
  period: HistoricalPeriod = "6M"
): Promise<Result<StockSnapshot>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  try {
    const [nameResult, quoteResult, historyResult] = await Promise.all([
      marketDataProvider.getCompanyName(ticker),
      getQuote(ticker),
      getHistoricalPrices(ticker, period),
    ]);

    if (!nameResult.ok) return nameResult;
    if (!quoteResult.ok) return quoteResult;
    if (!historyResult.ok) return historyResult;

    return {
      ok: true,
      data: {
        ticker,
        companyName: nameResult.data,
        quote: quoteResult.data,
        history: historyResult.data,
        period,
        provenance: {
          provider: marketDataProvider.id,
          isMock: marketDataProvider.isMock,
          fetchedAt: new Date().toISOString(),
          fromCache: false, // best-effort: this composite doesn't track sub-call cache hits
        },
      },
    };
  } catch (err) {
    return internalError("getStockSnapshot", ticker, err);
  }
}

function toQuote(ticker: string, row: {
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
  retrievedAt: Date;
}): Quote {
  return {
    ticker,
    price: row.price,
    change: row.change,
    changePercent: row.changePercent,
    dayHigh: row.dayHigh,
    dayLow: row.dayLow,
    previousClose: row.previousClose,
    volume: row.volume,
    marketCap: row.marketCap,
    week52High: row.week52High,
    week52Low: row.week52Low,
    avgVolume: row.avgVolume,
    asOf: row.retrievedAt.toISOString(),
  };
}

function toPriceBar(row: {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): PriceBar {
  return {
    timestamp: row.timestamp.toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

function internalError(fn: string, ticker: string, err: unknown): Result<never> {
  log.error(`${fn} failed`, { ticker, error: err instanceof Error ? err.message : String(err) });
  return {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Failed to fetch market data." },
  };
}
