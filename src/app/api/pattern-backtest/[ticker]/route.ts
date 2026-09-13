import { NextRequest, NextResponse } from "next/server";
import { getIntradayHistory } from "@/server/market-data";
import { backtestPatterns } from "@/lib/pattern-backtest";
import { BARS_PER_TRADING_DAY, type IntradayInterval } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("api:pattern-backtest");

// Pure computation over already-fetched bars, plus one provider call.
// No AI is involved anywhere in this route, which is the entire point of
// this phase -- validating the patterns must not cost anything per run.
export const maxDuration = 120;

const INTERVAL: IntradayInterval = "5min";
const DEFAULT_LOOKBACK_DAYS = 90;

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const url = new URL(req.url);

  const horizonDays = Number(url.searchParams.get("horizonDays") ?? "1");
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? DEFAULT_LOOKBACK_DAYS);

  if (!Number.isFinite(horizonDays) || horizonDays < 1 || horizonDays > 7) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "horizonDays must be between 1 and 7." } },
      { status: 400 }
    );
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);

  const barsResult = await getIntradayHistory(ticker, INTERVAL, from, to);
  if (!barsResult.ok) {
    return NextResponse.json({ error: barsResult.error }, { status: 502 });
  }

  // Horizon arrives in days but the backtest measures in bars, since that
  // is the unit the data actually comes in.
  const horizonBars = Math.round(horizonDays * BARS_PER_TRADING_DAY[INTERVAL]);
  const result = backtestPatterns(ticker, barsResult.data, horizonBars);

  log.info("pattern backtest complete", {
    ticker,
    bars: barsResult.data.length,
    horizonBars,
    patternsFound: result.patterns.length,
  });

  return NextResponse.json({ ...result, interval: INTERVAL, horizonDays, lookbackDays });
}
