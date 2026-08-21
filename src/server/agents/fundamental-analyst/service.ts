import { getFundamentals } from "@/server/fundamentals";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { FinancialPeriodType } from "@/lib/fundamentals-types";
import type { FundamentalAnalystResult } from "@/lib/fundamental-analyst-types";
import { calculateFundamentalMetrics } from "./metrics";
import { interpretFundamentalMetrics } from "./interpreter";

const log = logger.child("agents:fundamental-analyst");

/**
 * The Fundamental Analyst Agent.
 *
 * Integration, not duplication: this function gets its financial data
 * exclusively through `getFundamentals` from `@/server/fundamentals` --
 * Step 5's own public service barrel. It never imports a fundamentals
 * provider, never calls FMP directly, and never touches the database.
 * Every number this agent works with has already been fetched, cached,
 * persisted, and validated by Step 5 before this agent ever sees it --
 * this file adds a purely derived (CalculatedFundamentalMetrics) and
 * interpreted (AI) layer on top, nothing more.
 *
 * "Never invent financial numbers" is enforced structurally, not just by
 * instruction: this file only ever passes along whatever
 * `calculateFundamentalMetrics` computed from the real periods Step 5
 * returned. If a period is missing a figure, that figure is `null` all
 * the way through to the AI prompt, and the AI is instructed to say
 * "Data unavailable." rather than fill the gap.
 */
export async function runFundamentalAnalysis(
  rawTicker: string,
  periodType: FinancialPeriodType = "annual"
): Promise<Result<FundamentalAnalystResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const fundamentalsResult = await getFundamentals(ticker, periodType);
  if (!fundamentalsResult.ok) return fundamentalsResult;

  const periods = fundamentalsResult.data.periods.map((p) => p.period);
  if (periods.length === 0) {
    return {
      ok: false,
      error: { code: "INSUFFICIENT_DATA", message: `No financial statement data available for ${ticker}.` },
    };
  }

  const calculated = calculateFundamentalMetrics(ticker, periods);

  const interpretationResult = await interpretFundamentalMetrics(calculated);
  if (!interpretationResult.ok) {
    log.warn("fundamental analysis calculated but not interpreted", {
      ticker,
      periodType,
      error: interpretationResult.error,
    });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      periodType,
      calculated,
      interpretation: interpretationResult.data,
    },
  };
}
