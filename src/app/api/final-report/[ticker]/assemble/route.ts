import { NextRequest, NextResponse } from "next/server";
import { assembleFinalReport } from "@/server/agents/final-report";
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

  return NextResponse.json(result.data);
}
