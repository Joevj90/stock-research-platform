import type { AnalystOutput, Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("ai-analysis");

/**
 * AI analysis service — STUB IN PHASE 1.
 *
 * This module is the second half of the market-data / AI-analysis API
 * split called for in the requirements. It intentionally does nothing real
 * yet: no multi-agent analysts, no investment committee, no devil's
 * advocate, no forecasts. Those are later phases.
 *
 * What exists now is the *shape* future phases will fill in:
 *   - a single entry point (`runAnalysis`) the API route calls
 *   - a typed return contract (`AnalystOutput`, from src/lib/types.ts)
 *   - a place later phases can register individual agents
 *
 * It must never fabricate confidence scores, theses, or citations — an
 * honest "not implemented" is the correct Phase 1 behavior.
 */
export async function runAnalysis(ticker: string): Promise<Result<AnalystOutput[]>> {
  log.info("analysis requested, but AI analysis is not implemented in Phase 1", { ticker });

  return {
    ok: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message:
        "AI analysis (analysts, investment committee, devil's advocate, forecasts) is not built yet. " +
        "This endpoint is a placeholder for later phases.",
    },
  };
}
