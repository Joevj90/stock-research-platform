import type { FundamentalsProvider } from "./provider.interface";
import type { FinancialPeriod, FinancialPeriodType } from "@/lib/fundamentals-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("fundamentals:fmp");

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Financial Modeling Prep fundamentals provider -- the real,
 * non-mock source for income statement, balance sheet, and cash flow
 * statement data. FMP standardizes these from SEC filings (10-K/10-Q)
 * and returns filing date + fiscal year/period alongside each period,
 * which is what lets this app attach real provenance to every figure.
 *
 * This class's only job is fetching FMP's three statement endpoints and
 * merging them (by fiscalYear + period) into this app's normalized
 * FinancialPeriod shape. It performs no validation, no caching, and no
 * DB writes -- that's service.ts, same separation of concerns as the
 * market-data module.
 */
export class FmpFundamentalsProvider implements FundamentalsProvider {
  readonly id = "fmp" as const;
  readonly isMock = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "FmpFundamentalsProvider requires FMP_API_KEY to be set. Get a free key at " +
          "https://site.financialmodelingprep.com/ and set it in your .env file."
      );
    }
  }

  async getFinancials(
    ticker: string,
    periodType: FinancialPeriodType,
    limit: number
  ): Promise<Result<FinancialPeriod[]>> {
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
      };
    }

    const fmpPeriod = periodType === "annual" ? "annual" : "quarter";

    const [incomeResult, balanceResult, cashFlowResult] = await Promise.all([
      this.fetchJson<FmpIncomeStatementRow[]>("/income-statement", { symbol: ticker, period: fmpPeriod, limit: String(limit) }),
      this.fetchJson<FmpBalanceSheetRow[]>("/balance-sheet-statement", { symbol: ticker, period: fmpPeriod, limit: String(limit) }),
      this.fetchJson<FmpCashFlowRow[]>("/cash-flow-statement", { symbol: ticker, period: fmpPeriod, limit: String(limit) }),
    ]);

    if (!incomeResult.ok) return incomeResult;
    if (!balanceResult.ok) return balanceResult;
    if (!cashFlowResult.ok) return cashFlowResult;

    if (incomeResult.data.length === 0) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `No financial statement data found for ticker "${ticker}".` },
      };
    }

    // Merge the three statements by reporting date -- FMP returns all
    // three keyed the same way (date/fiscalYear/period), so a plain date
    // match is reliable.
    const balanceByDate = new Map(balanceResult.data.map((r) => [r.date, r]));
    const cashFlowByDate = new Map(cashFlowResult.data.map((r) => [r.date, r]));

    const periods: FinancialPeriod[] = incomeResult.data.map((income) => {
      const balance = balanceByDate.get(income.date);
      const cashFlow = cashFlowByDate.get(income.date);
      const capex = cashFlow?.capitalExpenditure ?? null;

      return {
        source: "fmp",
        ticker: ticker.toUpperCase(),
        periodType,
        fiscalYear: Number(income.fiscalYear ?? new Date(income.date).getFullYear()),
        fiscalQuarter: periodType === "quarterly" ? parseFiscalQuarter(income.period) : null,
        reportingPeriodEnd: new Date(income.date).toISOString(),
        filingDate: income.filingDate ? new Date(income.filingDate).toISOString() : null,
        retrievedAt: new Date().toISOString(),
        reportedCurrency: income.reportedCurrency ?? null,

        revenue: income.revenue ?? null,
        grossProfit: income.grossProfit ?? null,
        operatingIncome: income.operatingIncome ?? null,
        netIncome: income.netIncome ?? null,
        eps: income.eps ?? null,

        cash: balance?.cashAndCashEquivalents ?? null,
        totalAssets: balance?.totalAssets ?? null,
        totalLiabilities: balance?.totalLiabilities ?? null,
        totalDebt: balance?.totalDebt ?? null,
        shareholdersEquity: balance?.totalStockholdersEquity ?? null,

        operatingCashFlow: cashFlow?.operatingCashFlow ?? null,
        capitalExpenditures: capex,
        freeCashFlow: cashFlow?.freeCashFlow ?? null,
      };
    });

    return { ok: true, data: periods };
  }

  private async fetchJson<T>(path: string, params: Record<string, string>): Promise<Result<T>> {
    const url = new URL(`${FMP_BASE_URL}${path}`);
    url.searchParams.set("apikey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });

      if (res.status === 401 || res.status === 403) {
        log.error("FMP authentication failed", { status: res.status, path });
        return {
          ok: false,
          error: { code: "PROVIDER_AUTH_ERROR", message: "Market data provider rejected the API key." },
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          error: { code: "PROVIDER_RATE_LIMITED", message: "Market data provider rate limit exceeded." },
        };
      }
      if (!res.ok) {
        log.error("FMP request failed", { status: res.status, path });
        return {
          ok: false,
          error: { code: "PROVIDER_ERROR", message: `Market data provider returned ${res.status}.` },
        };
      }

      const json = (await res.json()) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_ERROR",
            message: String((json as { "Error Message": unknown })["Error Message"]),
          },
        };
      }

      return { ok: true, data: (Array.isArray(json) ? json : []) as T };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      log.error("FMP request threw", { path, error: err instanceof Error ? err.message : String(err) });
      return {
        ok: false,
        error: {
          code: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
          message: isAbort ? "Market data provider timed out." : "Could not reach the market data provider.",
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** FMP's `period` field looks like "Q1"/"Q2"/"Q3"/"Q4" for quarterly rows. */
function parseFiscalQuarter(period: string | undefined): number | null {
  if (!period) return null;
  const match = period.match(/Q([1-4])/i);
  return match ? Number(match[1]) : null;
}

interface FmpIncomeStatementRow {
  date: string;
  fiscalYear?: number | string;
  period?: string;
  filingDate?: string;
  reportedCurrency?: string;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
}

interface FmpBalanceSheetRow {
  date: string;
  cashAndCashEquivalents?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  totalDebt?: number;
  totalStockholdersEquity?: number;
}

interface FmpCashFlowRow {
  date: string;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
}
