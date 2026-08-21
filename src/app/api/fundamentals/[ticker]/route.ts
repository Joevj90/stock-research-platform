import { NextRequest, NextResponse } from "next/server";
import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { FinancialPeriodType } from "@/lib/fundamentals-types";

const log = logger.child("api:fundamentals");

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  MISSING_TICKER: 400,
  INVALID_TICKER: 404,
  INVALID_PERIOD_TYPE: 400,
  INTERNAL_ERROR: 500,
  PROVIDER_AUTH_ERROR: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNREACHABLE: 502,
  PROVIDER_ERROR: 502,
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

  const result = await getFundamentals(params.ticker, periodTypeParam);

  if (!result.ok) {
    const status = STATUS_BY_ERROR_CODE[result.error.code] ?? 502;
    log.warn("fundamentals request failed", { ticker: params.ticker, error: result.error });
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.data);
}
