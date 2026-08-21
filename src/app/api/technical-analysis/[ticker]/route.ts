import { NextRequest, NextResponse } from "next/server";
import { runTechnicalAnalysis } from "@/server/agents/technical-analysis";
import { logger } from "@/server/logger";
import { HISTORICAL_PERIODS, type HistoricalPeriod } from "@/lib/types";

const log = logger.child("api:technical-analysis");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INVALID_PERIOD: 400,
  INSUFFICIENT_DATA: 422,
  INTERNAL_ERROR: 500,
  PROVIDER_AUTH_ERROR: 502,
  PROVIDER_RATE_LIMITED: 429,
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

function isHistoricalPeriod(value: string): value is HistoricalPeriod {
  return (HISTORICAL_PERIODS as string[]).includes(value);
}

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const periodParam = req.nextUrl.searchParams.get("period") ?? "1Y";

  if (!isHistoricalPeriod(periodParam)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PERIOD",
          message: `period must be one of ${HISTORICAL_PERIODS.join(", ")}.`,
        },
      },
      { status: 400 }
    );
  }

  const result = await runTechnicalAnalysis(params.ticker, periodParam);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("technical analysis request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
