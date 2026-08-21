import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type {
  FinancialPeriod,
  FinancialPeriodType,
  FundamentalsResult,
  ValidatedFinancialPeriod,
} from "@/lib/fundamentals-types";
import { fundamentalsProvider } from "./provider";
import { FUNDAMENTALS_CACHE_TTL_MS, isFresh } from "./cache";
import { validateFinancialPeriod } from "./validate";
import { computeFinancialRatios } from "./ratios";
import { explainMetricSeries } from "./explain";

const log = logger.child("fundamentals:service");

const DEFAULT_LIMIT_ANNUAL = 8;
const DEFAULT_LIMIT_QUARTERLY = 12;

/**
 * ⚠️ ARCHITECTURAL BOUNDARY ⚠️ (same pattern as market-data/service.ts)
 *
 * This is the ONLY file allowed to import `fundamentalsProvider` or touch
 * the database for financial-statement data. Everything else — API
 * routes, UI, and any future Fundamental Analyst agent — must go through
 * `getFundamentals` here. That keeps the same
 * UI → Backend → Data Service → Provider shape this app already enforces
 * for market data.
 */
export async function getFundamentals(
  rawTicker: string,
  periodType: FinancialPeriodType
): Promise<Result<FundamentalsResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  try {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker },
    });

    const cacheEntry = await prisma.fundamentalsCacheEntry.findUnique({
      where: { stockId_periodType: { stockId: stock.id, periodType } },
    });

    let periods: FinancialPeriod[];

    if (cacheEntry && cacheEntry.provider === fundamentalsProvider.id && isFresh(cacheEntry.retrievedAt, FUNDAMENTALS_CACHE_TTL_MS)) {
      const rows = await prisma.financials.findMany({
        where: { stockId: stock.id, periodType },
        orderBy: { periodEnd: "asc" },
      });
      if (rows.length > 0) {
        log.debug("fundamentals cache hit", { ticker, periodType });
        periods = rows.map((row: FinancialsRow) => ({ ...rowToFinancialPeriod(row), ticker }));
      } else {
        const fetched = await fetchAndPersist(ticker, periodType, stock.id);
        if (!fetched.ok) return fetched;
        periods = fetched.data;
      }
    } else {
      log.debug("fundamentals cache miss — calling provider", { ticker, periodType });
      const fetched = await fetchAndPersist(ticker, periodType, stock.id);
      if (!fetched.ok) return fetched;
      periods = fetched.data;
    }

    return { ok: true, data: buildFundamentalsResult(ticker, periodType, periods) };
  } catch (err) {
    log.error("getFundamentals failed", { ticker, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to fetch fundamentals." } };
  }
}

async function fetchAndPersist(
  ticker: string,
  periodType: FinancialPeriodType,
  stockId: string
): Promise<Result<FinancialPeriod[]>> {
  const limit = periodType === "annual" ? DEFAULT_LIMIT_ANNUAL : DEFAULT_LIMIT_QUARTERLY;
  const result = await fundamentalsProvider.getFinancials(ticker, periodType, limit);
  if (!result.ok) return result;

  // Provider returns most-recent-first; store oldest-first for trend display.
  const periods = [...result.data].reverse();

  await prisma.$transaction([
    ...periods.map((p) => {
      const warnings = validateFinancialPeriod(p);
      return prisma.financials.upsert({
        where: {
          stockId_periodEnd_periodType: {
            stockId,
            periodEnd: new Date(p.reportingPeriodEnd),
            periodType: p.periodType,
          },
        },
        update: financialPeriodToRow(p, warnings),
        create: {
          stockId,
          periodEnd: new Date(p.reportingPeriodEnd),
          periodType: p.periodType,
          ...financialPeriodToRow(p, warnings),
        },
      });
    }),
    prisma.fundamentalsCacheEntry.upsert({
      where: { stockId_periodType: { stockId, periodType } },
      update: { provider: fundamentalsProvider.id, retrievedAt: new Date() },
      create: { stockId, periodType, provider: fundamentalsProvider.id },
    }),
  ]);

  return { ok: true, data: periods };
}

function buildFundamentalsResult(
  ticker: string,
  periodType: FinancialPeriodType,
  periods: FinancialPeriod[]
): FundamentalsResult {
  const validated: ValidatedFinancialPeriod[] = periods.map((period) => ({
    period,
    warnings: validateFinancialPeriod(period),
  }));
  const ratios = periods.map(computeFinancialRatios);

  const series = (key: keyof FinancialPeriod) => periods.map((p) => p[key] as number | null);

  return {
    ticker,
    periodType,
    periods: validated,
    ratios,
    metricSeries: {
      revenue: explainMetricSeries("revenue", series("revenue"), periodType),
      grossProfit: explainMetricSeries("grossProfit", series("grossProfit"), periodType),
      operatingIncome: explainMetricSeries("operatingIncome", series("operatingIncome"), periodType),
      netIncome: explainMetricSeries("netIncome", series("netIncome"), periodType),
      eps: explainMetricSeries("eps", series("eps"), periodType),
      cash: explainMetricSeries("cash", series("cash"), periodType),
      totalDebt: explainMetricSeries("totalDebt", series("totalDebt"), periodType),
      freeCashFlow: explainMetricSeries("freeCashFlow", series("freeCashFlow"), periodType),
    },
  };
}

// --- Prisma <-> domain-type mapping helpers ---

function financialPeriodToRow(p: FinancialPeriod, warnings: { code: string; message: string }[]) {
  return {
    fiscalYear: p.fiscalYear,
    fiscalQuarter: p.fiscalQuarter,
    filingDate: p.filingDate ? new Date(p.filingDate) : null,
    reportedCurrency: p.reportedCurrency,
    provider: fundamentalsProvider.id,
    retrievedAt: new Date(),
    revenue: p.revenue,
    grossProfit: p.grossProfit,
    operatingIncome: p.operatingIncome,
    netIncome: p.netIncome,
    eps: p.eps,
    cash: p.cash,
    totalAssets: p.totalAssets,
    totalLiabilities: p.totalLiabilities,
    totalDebt: p.totalDebt,
    shareholdersEquity: p.shareholdersEquity,
    operatingCashFlow: p.operatingCashFlow,
    capitalExpenditures: p.capitalExpenditures,
    freeCashFlow: p.freeCashFlow,
    validationWarnings: JSON.stringify(warnings),
  };
}

interface FinancialsRow {
  periodEnd: Date;
  periodType: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  filingDate: Date | null;
  reportedCurrency: string | null;
  provider: string;
  retrievedAt: Date;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  cash: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalDebt: number | null;
  shareholdersEquity: number | null;
  operatingCashFlow: number | null;
  capitalExpenditures: number | null;
  freeCashFlow: number | null;
}

function rowToFinancialPeriod(row: FinancialsRow): FinancialPeriod {
  return {
    source: row.provider,
    ticker: "", // filled in by the caller context; not stored per-row
    periodType: row.periodType as FinancialPeriodType,
    fiscalYear: row.fiscalYear,
    fiscalQuarter: row.fiscalQuarter,
    reportingPeriodEnd: row.periodEnd.toISOString(),
    filingDate: row.filingDate ? row.filingDate.toISOString() : null,
    retrievedAt: row.retrievedAt.toISOString(),
    reportedCurrency: row.reportedCurrency,
    revenue: row.revenue,
    grossProfit: row.grossProfit,
    operatingIncome: row.operatingIncome,
    netIncome: row.netIncome,
    eps: row.eps,
    cash: row.cash,
    totalAssets: row.totalAssets,
    totalLiabilities: row.totalLiabilities,
    totalDebt: row.totalDebt,
    shareholdersEquity: row.shareholdersEquity,
    operatingCashFlow: row.operatingCashFlow,
    capitalExpenditures: row.capitalExpenditures,
    freeCashFlow: row.freeCashFlow,
  };
}
