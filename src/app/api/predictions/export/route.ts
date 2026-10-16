import { NextResponse } from "next/server";
import { exportAllPredictions } from "@/server/predictions";
import { logger } from "@/server/logger";

const log = logger.child("api:predictions:export");

// Evaluating anything newly due can touch the market-data provider once
// per due prediction, so allow more than a trivial budget. No AI call is
// made anywhere in this route.
export const maxDuration = 120;

export async function GET() {
  const data = await exportAllPredictions();
  log.info("prediction export generated", { totalPredictions: data.totalPredictions });

  // Content-Disposition so the browser saves a file instead of rendering
  // a wall of JSON that has to be copied by hand.
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="predictions-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
