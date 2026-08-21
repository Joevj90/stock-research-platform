import { getFundamentals } from "@/server/fundamentals";
import { getInsiderTransactions } from "@/server/insider-trading";
import { getStockSnapshot } from "@/server/market-data";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { ManagementAnalysisResult } from "@/lib/management-types";
import { computeCapitalAllocationSignal } from "./capital-allocation";
import { summarizeInsiderActivity } from "./insider-summary";
import { interpretManagement } from "./interpreter";

const log = logger.child("agents:management-analysis");

/**
 * The Management Analysis Agent.
 *
 * Integration, not duplication: capital-allocation signals come from
 * Step 5's real financial-statement history via `getFundamentals`
 * (`@/server/fundamentals`); insider transactions come from the new
 * `@/server/insider-trading` module (built this step, mirroring the
 * exact provider/service/cache pattern already used by market-data,
 * fundamentals, and news); the company name comes from Step 1's
 * `getStockSnapshot`. Never a provider directly, never the database
 * directly.
 *
 * This is also where the "never fabricate management statements" rule
 * is enforced structurally: this service has no data source for
 * historical guidance statements at all, so there is nothing for the AI
 * to fabricate from -- the interpreter is instructed to say so plainly
 * rather than reach for its own training-data recall.
 */
export async function runManagementAnalysis(rawTicker: string): Promise<Result<ManagementAnalysisResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  const [fundamentalsResult, insiderResult, snapshotResult] = await Promise.all([
    getFundamentals(ticker, "annual"),
    getInsiderTransactions(ticker),
    getStockSnapshot(ticker, "1M"),
  ]);

  if (!fundamentalsResult.ok) return fundamentalsResult;
  if (!insiderResult.ok) return insiderResult;

  const companyName = snapshotResult.ok ? snapshotResult.data.companyName : null;
  const periods = fundamentalsResult.data.periods.map((p) => p.period);

  const capitalAllocation = computeCapitalAllocationSignal(periods);
  const insiderActivitySummary = summarizeInsiderActivity(insiderResult.data);

  const interpretationResult = await interpretManagement({
    ticker,
    companyName,
    capitalAllocation,
    insiderActivitySummary,
    recentInsiderTransactions: insiderResult.data.slice(0, 10),
  });

  if (!interpretationResult.ok) {
    log.warn("management signals gathered but not interpreted", { ticker, error: interpretationResult.error });
    return interpretationResult;
  }

  return {
    ok: true,
    data: {
      ticker,
      companyName,
      generatedAt: new Date().toISOString(),
      capitalAllocation,
      insiderActivity: insiderActivitySummary,
      recentInsiderTransactionCount: insiderResult.data.length,
      interpretation: interpretationResult.data,
    },
  };
}
