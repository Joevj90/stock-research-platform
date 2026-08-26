import { NextRequest, NextResponse } from "next/server";
import { compareTwoAnalyses } from "@/server/analysis-history";
import { logger } from "@/server/logger";

const log = logger.child("api:analysis-history:compare");

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { currentId: string; previousId: string };

  if (!body.currentId || !body.previousId) {
    return NextResponse.json(
      { error: { code: "MISSING_TICKER", message: "Both currentId and previousId are required." } },
      { status: 400 }
    );
  }

  const result = await compareTwoAnalyses(body.currentId, body.previousId);

  if (!result.ok) {
    log.warn("manual comparison request failed", { error: result.error });
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
