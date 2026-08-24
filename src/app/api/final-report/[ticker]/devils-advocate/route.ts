import { NextRequest, NextResponse } from "next/server";
import { runDevilsAdvocate } from "@/server/agents/devils-advocate";
import { logger } from "@/server/logger";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";

const log = logger.child("api:final-report:devils-advocate");

export const maxDuration = 180;

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
  const body = (await req.json()) as {
    gathered: GatheredAnalysisInputs;
    forecast: ForecastResult;
    committee: CommitteeResult;
  };

  const result = await runDevilsAdvocate(ticker, {
    gathered: body.gathered,
    forecastResult: { ok: true, data: body.forecast },
    committeeResult: { ok: true, data: body.committee },
  });

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("devil's advocate step failed", { ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
