import { NextRequest, NextResponse } from "next/server";
import { getPredictionHistory } from "@/server/predictions";
import { logger } from "@/server/logger";

const log = logger.child("api:predictions:ticker");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INTERNAL_ERROR: 500,
};

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const result = await getPredictionHistory(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("prediction history request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
