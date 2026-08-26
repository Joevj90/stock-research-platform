import { NextRequest, NextResponse } from "next/server";
import { getSavedAnalysisReport } from "@/server/analysis-history";
import { logger } from "@/server/logger";

const log = logger.child("api:analysis-history:report");

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getSavedAnalysisReport(params.id);

  if (!result.ok) {
    log.warn("saved analysis report request failed", { id: params.id, error: result.error });
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(result.data);
}
