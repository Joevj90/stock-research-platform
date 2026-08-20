import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result, StockSnapshot } from "@/lib/types";
import { marketDataProvider } from "./index";

const log = logger.child("market-data:snapshot");
const HISTORY_DAYS = 180;

/**
 * Fetches a full stock snapshot (name, quote, history) from the configured
 * provider, persists Stock + PriceBar rows, and returns a tagged snapshot.
 *
 * This is the single implementation used by both the /api/market-data route
 * (for external/future-agent callers) and the dashboard server component
 * (to avoid an unnecessary self HTTP round trip). Keeping one implementation
 * means persistence and provenance tagging can't drift between the two.
 */
export async function getStockSnapshot(rawTicker: string): Promise<Result<StockSnapshot>> {
  const ticker = rawTicker.trim().toUpperCase();

  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  try {
    const [nameResult, quoteResult, historyResult] = await Promise.all([
      marketDataProvider.getCompanyName(ticker),
      marketDataProvider.getQuote(ticker),
      marketDataProvider.getHistory(ticker, HISTORY_DAYS),
    ]);

    if (!nameResult.ok) return nameResult;
    if (!quoteResult.ok) return quoteResult;
    if (!historyResult.ok) return historyResult;

    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: { name: nameResult.data },
      create: { ticker, name: nameResult.data },
    });

    await prisma.$transaction(
      historyResult.data.map((bar) =>
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
      )
    );

    log.info("built stock snapshot", { ticker, provider: marketDataProvider.id });

    return {
      ok: true,
      data: {
        ticker,
        companyName: nameResult.data,
        quote: quoteResult.data,
        history: historyResult.data,
        provenance: {
          provider: marketDataProvider.id,
          isMock: marketDataProvider.isMock,
          fetchedAt: new Date().toISOString(),
        },
      },
    };
  } catch (err) {
    log.error("failed to build stock snapshot", {
      ticker,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch market data." },
    };
  }
}
