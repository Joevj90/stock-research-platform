import { NextRequest, NextResponse } from "next/server";
import { runFundamentalAnalysis } from "@/server/agents/fundamental-analyst";
import { logger } from "@/server/logger";
import type { FinancialPeriodType } from "@/lib/fundamentals-types";

// Real, detailed data can take longer to generate than Vercel's default
// function timeout allows -- raise it to the Hobby-plan maximum.
export const maxDuration = 60;

const log = logger.child("api:fundamental-analysis");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INVALID_PERIOD_TYPE: 400,
  INSUFFICIENT_DATA: 422,
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

function isPeriodType(value: string): value is FinancialPeriodType {
  return value === "annual" || value === "quarterly";
}

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const periodTypeParam = req.nextUrl.searchParams.get("period") ?? "annual";

  if (!isPeriodType(periodTypeParam)) {
    return NextResponse.json(
      { error: { code: "INVALID_PERIOD_TYPE", message: "period must be 'annual' or 'quarterly'." } },
      { status: 400 }
    );
  }

  const result = await runFundamentalAnalysis(params.ticker, periodTypeParam);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("fundamental analysis request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
