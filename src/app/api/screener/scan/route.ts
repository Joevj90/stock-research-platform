import { NextRequest, NextResponse } from "next/server";
import { scanValuationGapChunk } from "@/server/agents/screener";
import { logger } from "@/server/logger";

const log = logger.child("api:screener:scan");

// Each chunk is capped client-side (see useScreener.ts) at a size chosen
// to comfortably finish within this budget even on a cold cache -- no AI
// calls happen in this route, only real price/financial-statement
// fetches, so this is far cheaper per-ticker than any Final Report step.
export const maxDuration = 120;

const MAX_CHUNK_SIZE = 50;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { tickers?: unknown };

  if (!Array.isArray(body.tickers) || body.tickers.some((t) => typeof t !== "string")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Request body must include a `tickers` array of strings." } },
      { status: 400 }
    );
  }

  const tickers = (body.tickers as string[]).slice(0, MAX_CHUNK_SIZE);
  if (tickers.length === 0) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "`tickers` must contain at least one ticker." } },
      { status: 400 }
    );
  }

  const result = await scanValuationGapChunk(tickers);
  log.info("valuation gap chunk scanned", {
    requested: tickers.length,
    succeeded: result.candidates.length,
    failed: result.failedTickers.length,
  });

  return NextResponse.json(result);
}
