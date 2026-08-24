import { NextRequest, NextResponse } from "next/server";
import { gatherAnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import { logger } from "@/server/logger";

const log = logger.child("api:final-report:gather");

// This is the single most expensive step (up to 8 agents, two of which
// are themselves 2-call chains via shared News Intelligence) -- give it
// most of Vercel Pro's budget, while still leaving comfortable headroom
// under the 300s ceiling (unlike the old one-shot endpoint, which had to
// fit this step AND three more AI calls in the same 300s).
export const maxDuration = 240;

export async function POST(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } }, { status: 400 });
  }

  const gathered = await gatherAnalysisSummaries(ticker);
  if (gathered.currentPrice === null) {
    log.warn("gather step found no price data", { ticker });
    return NextResponse.json(
      { error: { code: "INVALID_TICKER", message: `Could not find price data for "${ticker}".` } },
      { status: 404 }
    );
  }

  return NextResponse.json(gathered);
}
