import { NextResponse } from "next/server";
import { runScanBatch, startScan } from "@/server/suggestions";

/**
 * Runs the Trend Reset scan over the S&P 500, one batch per request.
 *
 *   POST {}                      -> starts a scan: { id, totalBatches }
 *   POST { scanId, batch: n }    -> runs batch n, returns the scan so far
 *
 * CODE ONLY: no agent, no AI call (a structural test enforces it). Each
 * batch is ~50 stocks and about two market-data requests, so it finishes
 * far inside the hosting plan's per-request time limit.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { scanId?: unknown; batch?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* empty body = start a new scan */
  }

  if (typeof body.scanId !== "string") {
    const started = await startScan();
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: 500 });
    return NextResponse.json(started.data, { status: 201 });
  }

  const batch = Number(body.batch);
  const result = await runScanBatch(body.scanId, batch);
  if (!result.ok) {
    const status = result.error.code === "BAD_REQUEST" || result.error.code === "NOT_FOUND" ? 400 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ scan: result.data }, { status: 200 });
}
