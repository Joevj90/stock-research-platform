import { NextRequest, NextResponse } from "next/server";
import { getStockSnapshot } from "@/server/market-data";
import { logger } from "@/server/logger";
import { HISTORICAL_PERIODS, type HistoricalPeriod } from "@/lib/types";

const log = logger.child("api:market-data");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INTERNAL_ERROR: 500,
  PROVIDER_AUTH_ERROR: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNREACHABLE: 502,
  PROVIDER_ERROR: 502,
};

function isHistoricalPeriod(value: string): value is HistoricalPeriod {
  return (HISTORICAL_PERIODS as string[]).includes(value);
}

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const periodParam = req.nextUrl.searchParams.get("period") ?? "6M";

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

  const result = await getStockSnapshot(params.ticker, periodParam);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("market data request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
