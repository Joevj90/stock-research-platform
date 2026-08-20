import { NextRequest, NextResponse } from "next/server";
import { runAnalysis } from "@/server/ai-analysis";
import { logger } from "@/server/logger";

const log = logger.child("api:analysis");

/**
 * AI analysis endpoint — separate namespace from /api/market-data on
 * purpose. Phase 1 returns 501 honestly instead of fabricating a thesis.
 */
export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.trim().toUpperCase();
  const result = await runAnalysis(ticker);

  if (!result.ok) {
    log.info("analysis not available", { ticker, code: result.error.code });
    return NextResponse.json({ error: result.error }, { status: 501 });
  }

  return NextResponse.json({ analyses: result.data });
}
