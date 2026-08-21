import { getMacroIndicators } from "@/server/macro";
import { getStockSnapshot } from "@/server/market-data";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { MacroResult } from "@/lib/macro-types";
import { interpretMacroEnvironment } from "./interpreter";

const log = logger.child("agents:macro-analysis");

/**
 * The Macro Analysis Agent.
 *
 * Integration, not duplication: economic indicators come exclusively
 * from `getMacroIndicators` (`@/server/macro`) -- never a provider
 * directly. The company name (used so the AI can reason about which
 * factors matter for THIS business) comes from `getStockSnapshot`
 * (`@/server/market-data`, Step 1) -- a call this app already makes
 * elsewhere, free of AI cost, not a new data source.
 *
 * If the company name can't be resolved, the analysis still proceeds --
 * the AI is instructed to note that it doesn't know the company's
 * specific business and keep the analysis more general rather than
 * guessing or fabricating industry context.
 */
export async function runMacroAnalysis(rawTicker: string): Promise<Result<MacroResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [indicatorsResult, snapshotResult] = await Promise.all([
    getMacroIndicators(),
    getStockSnapshot(ticker, "1M"),
  ]);

  if (!indicatorsResult.ok) return indicatorsResult;

  const companyName = snapshotResult.ok ? snapshotResult.data.companyName : null;

  const interpretationResult = await interpretMacroEnvironment({
    ticker,
    companyName,
    indicators: indicatorsResult.data,
  });

  if (!interpretationResult.ok) {
    log.warn("macro indicators fetched but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      indicators: indicatorsResult.data,
      interpretation: interpretationResult.data,
    },
  };
}
