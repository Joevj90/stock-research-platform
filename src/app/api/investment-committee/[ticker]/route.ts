import { NextRequest, NextResponse } from "next/server";
import { runInvestmentCommittee } from "@/server/agents/investment-committee";
import { logger } from "@/server/logger";

// Two sequential AI calls (personas, then debate) on top of gathering all
// 8 base agents -- raise Vercel's function timeout to its Hobby-plan
// maximum so the platform doesn't cut the request off early.
export const maxDuration = 280; // Vercel Pro allows up to 300s -- gather + two sequential AI calls

const log = logger.child("api:investment-committee");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INTERNAL_ERROR: 500,
  PROVIDER_AUTH_ERROR: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_PLAN_REQUIRED: 402,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNREACHABLE: 502,
  PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 501,
  AI_AUTH_ERROR: 502,
  AI_RATE_LIMITED: 429,
  AI_TIMEOUT: 504,
  AI_UNREACHABLE: 502,
  AI_PROVIDER_ERROR: 502,
  AI_PARSE_ERROR: 502,
};

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const result = await runInvestmentCommittee(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("investment committee request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
