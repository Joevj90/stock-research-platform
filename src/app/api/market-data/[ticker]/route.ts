import { NextRequest, NextResponse } from "next/server";
import { getStockSnapshot } from "@/server/market-data";
import { logger } from "@/server/logger";

const log = logger.child("api:market-data");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INTERNAL_ERROR: 500,
};

export async function GET(_req: NextRequest, { params }: { params: { ticker: string } }) {
  const result = await getStockSnapshot(params.ticker);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("market data request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
