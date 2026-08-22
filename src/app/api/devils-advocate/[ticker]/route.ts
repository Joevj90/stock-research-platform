import { NextRequest, NextResponse } from "next/server";
import { runDevilsAdvocate } from "@/server/agents/devils-advocate";
import { logger } from "@/server/logger";

// This is the most sequential-AI-call-heavy endpoint in the app (waits on
// the Investment Committee's two sequential calls, in parallel with
// Forecasting Agent's call, then makes its own call). Raise Vercel's
// function timeout to its Hobby-plan maximum so the platform itself
// doesn't cut the request off before the AI calls can finish. If you're
// on Vercel Pro or higher, you can raise this further (up to 300).
export const maxDuration = 60;

const log = logger.child("api:devils-advocate");

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
  const result = await runDevilsAdvocate(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("devil's advocate request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
