import { NextRequest, NextResponse } from "next/server";
import { assembleFinalReport } from "@/server/agents/final-report";
import { saveAnalysis } from "@/server/analysis-history";
import { logger } from "@/server/logger";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";

const log = logger.child("api:final-report:assemble");

// Pure computation, no AI call and no network call -- fast by design.
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.trim().toUpperCase();
  const body = (await req.json()) as {
    gathered: GatheredAnalysisInputs;
    forecast: ForecastResult;
    committee: CommitteeResult;
    devilsAdvocate: DevilsAdvocateResult;
  };

  const result = assembleFinalReport(ticker, body.gathered, body.forecast, body.committee, body.devilsAdvocate);

  if (!result.ok) {
    log.warn("assemble step failed", { ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Permanently record this completed analysis for Step 19's history
  // (Step 18's own prediction recording already happens independently,
  // hooked into the forecast step). Every successful Final Report
  // becomes a new immutable historical version -- "Research Again" is
  // simply running this same flow again, so saving happens automatically
  // with no separate user-facing step. Failure here must never prevent
  // the user from seeing their report -- saveAnalysis handles its own
  // errors internally (returns a Result, never throws) -- but this MUST
  // be awaited, not fire-and-forget: a serverless function can be frozen
  // the instant its response is sent, which would silently kill an
  // un-awaited save before it ever reaches the database.
  const saveResult = await saveAnalysis(ticker, result.data, body.forecast);
  if (!saveResult.ok) {
    log.warn("final report succeeded but saving to history failed", { ticker, error: saveResult.error });
  }

  return NextResponse.json(result.data);
}
