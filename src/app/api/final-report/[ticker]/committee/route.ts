import { NextRequest, NextResponse } from "next/server";
import { runInvestmentCommittee } from "@/server/agents/investment-committee";
import { logger } from "@/server/logger";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";

const log = logger.child("api:final-report:committee");

// Two sequential AI calls (personas, then debate) -- comfortable margin
// under Vercel Pro's 300s ceiling on its own, unlike when this had to
// share that budget with gather + Forecast + Devil's Advocate too.
export const maxDuration = 280;

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  AI_NOT_CONFIGURED: 501,
  AI_AUTH_ERROR: 502,
  AI_RATE_LIMITED: 429,
  AI_TIMEOUT: 504,
  AI_UNREACHABLE: 502,
  AI_PROVIDER_ERROR: 502,
  AI_PARSE_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export async function POST(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.trim().toUpperCase();
  const body = (await req.json()) as { gathered: GatheredAnalysisInputs };

  const result = await runInvestmentCommittee(ticker, body.gathered);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("committee step failed", { ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
