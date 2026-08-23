import { NextRequest, NextResponse } from "next/server";
import { runForecast } from "@/server/agents/forecasting";
import { recordPredictionsFromForecast } from "@/server/predictions";
import { logger } from "@/server/logger";

// Depends on up to 8 other agents plus its own synthesis call -- raise
// Vercel's function timeout to its Hobby-plan maximum so the platform
// doesn't cut the request off early.
export const maxDuration = 240; // Vercel Pro allows up to 300s -- bounded by the slowest of up to 8 parallel agents plus its own call

const log = logger.child("api:forecast");

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
  const result = await runForecast(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("forecast request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  // Permanently record this forecast for accuracy tracking (Step 18).
  // Failure here must never prevent the user from seeing their forecast
  // -- recordPredictionsFromForecast handles its own errors internally.
  await recordPredictionsFromForecast(params.ticker.trim().toUpperCase(), result.data);

  return NextResponse.json(result.data);
}
