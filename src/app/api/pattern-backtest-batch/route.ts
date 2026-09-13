import { NextRequest, NextResponse } from "next/server";
import { getIntradayHistory } from "@/server/market-data";
import { collectContribution, poolContributions, type TickerContribution } from "@/lib/pattern-backtest";
import { BARS_PER_TRADING_DAY, type IntradayInterval } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("api:pattern-backtest-batch");

// No AI anywhere in this route, by design -- validating the patterns
// must stay free to run. The time budget is for the provider fetches:
// each ticker needs ~18 chunked intraday requests.
export const maxDuration = 280;

const INTERVAL: IntradayInterval = "5min";
const LOOKBACK_DAYS = 90;
const MAX_TICKERS = 10;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { tickers?: unknown; horizonDays?: unknown };

  if (!Array.isArray(body.tickers) || body.tickers.some((t) => typeof t !== "string")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "`tickers` must be an array of strings." } },
      { status: 400 }
    );
  }

  const horizonDays = Number(body.horizonDays ?? 1);
  if (!Number.isFinite(horizonDays) || horizonDays < 1 || horizonDays > 7) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "horizonDays must be between 1 and 7." } },
      { status: 400 }
    );
  }

  const tickers = [...new Set((body.tickers as string[]).map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    MAX_TICKERS
  );
  if (tickers.length === 0) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "At least one ticker is required." } },
      { status: 400 }
    );
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - LOOKBACK_DAYS);
  const horizonBars = Math.round(horizonDays * BARS_PER_TRADING_DAY[INTERVAL]);

  const contributions: TickerContribution[] = [];
  const skipped: string[] = [];

  // Sequential rather than parallel: each ticker already fans out into
  // ~18 chunked provider requests, so running tickers concurrently too
  // would multiply into a burst well past FMP's rate limit.
  for (const ticker of tickers) {
    const bars = await getIntradayHistory(ticker, INTERVAL, from, to);
    if (!bars.ok) {
      skipped.push(ticker);
      continue;
    }
    contributions.push(collectContribution(ticker, bars.data, horizonBars));
  }

  if (contributions.length === 0) {
    return NextResponse.json(
      { error: { code: "NO_DATA", message: "No data could be fetched for any requested ticker." } },
      { status: 502 }
    );
  }

  const pooled = poolContributions(contributions, horizonBars);
  log.info("pooled pattern backtest complete", {
    tickers: pooled.tickers.length,
    skipped: skipped.length,
    patterns: pooled.patterns.length,
  });

  return NextResponse.json({ ...pooled, skipped, horizonDays, interval: INTERVAL });
}
