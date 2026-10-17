import { NextResponse } from "next/server";
import { listWatchlist, addToWatchlist } from "@/server/watchlist";
import { logger } from "@/server/logger";

const log = logger.child("api:watchlist");

/** Reads and writes the watchlist. No AI, no market-data calls --
 * listing is a single database read. */
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listWatchlist();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ items: result.data }, { status: 200 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Expected a JSON body." } }, { status: 400 });
  }

  const { ticker, notes } = (body ?? {}) as { ticker?: unknown; notes?: unknown };
  if (typeof ticker !== "string") {
    return NextResponse.json({ error: { code: "MISSING_TICKER", message: "A ticker is required." } }, { status: 400 });
  }

  const result = await addToWatchlist(ticker, typeof notes === "string" ? notes : undefined);
  if (!result.ok) {
    // A full list or a duplicate is the user's situation to resolve, not
    // a server fault, so these answer 400 rather than 500.
    const status = result.error.code === "DB_ERROR" ? 500 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  log.info("watchlist add", { ticker: result.data.ticker });
  return NextResponse.json({ item: result.data }, { status: 201 });
}
