import { NextRequest, NextResponse } from "next/server";
import { getAnalysisHistory } from "@/server/analysis-history";
import { logger } from "@/server/logger";

const log = logger.child("api:analysis-history");

// The comparison narrative call (if there are 2+ saved analyses) is the
// only AI call this route can trigger -- generous but bounded margin.
export const maxDuration = 120;

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
};

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const result = await getAnalysisHistory(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("analysis history request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
