import { NextResponse } from "next/server";
import { checkWatchlist } from "@/server/watchlist";
import { logger } from "@/server/logger";

const log = logger.child("api:watchlist:check");

/**
 * Runs the Trend Reset conditions over every stock on the watchlist.
 *
 * CODE ONLY. This route imports no agent and makes no Anthropic call --
 * it fetches price bars (cached 12 hours) and does arithmetic. That is
 * the whole point of it being separate from the AI analysis route.
 *
 * Budget: at most one market-data request per stock, capped at 25 by
 * the watchlist size limit, against a 250-request daily plan.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await checkWatchlist();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  log.info("watchlist check complete", {
    stocks: result.data.rows.length,
    qualifying: result.data.qualifyingCount,
  });
  return NextResponse.json(result.data, { status: 200 });
}
