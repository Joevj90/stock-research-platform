import type { FundamentalsProvider } from "./provider.interface";
import type { FinancialPeriod, FinancialPeriodType } from "@/lib/fundamentals-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("fundamentals:mock");

/**
 * MOCK fundamentals provider -- NOT real financial data. Generates
 * deterministic, seeded pseudo-random (but internally consistent --
 * satisfies the accounting equation, gross profit <= revenue, etc.)
 * figures so the app is fully runnable and its validation checks are
 * exercisable without a real API key. Every value is tagged `isMock: true`
 * one layer up, same convention as the mock market-data provider.
 */
export class MockFundamentalsProvider implements FundamentalsProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

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

    const rng = seededRng(ticker);
    const periods: FinancialPeriod[] = [];
    const now = new Date();
    let revenue = 5_000_000_000 + rng() * 50_000_000_000;

    for (let i = limit - 1; i >= 0; i--) {
      revenue *= 1 + (rng() - 0.35) * 0.15; // mild upward drift, still variable

      const grossMargin = 0.35 + rng() * 0.3;
      const grossProfit = revenue * grossMargin;
      const operatingMargin = grossMargin * (0.4 + rng() * 0.3);
      const operatingIncome = revenue * operatingMargin;
      const netIncome = operatingIncome * (0.6 + rng() * 0.3);
      const sharesOutstanding = 1_000_000_000 + rng() * 5_000_000_000;
      const eps = netIncome / sharesOutstanding;

      const totalAssets = revenue * (1.5 + rng() * 1.5);
      const totalLiabilities = totalAssets * (0.3 + rng() * 0.3);
      const shareholdersEquity = totalAssets - totalLiabilities;
      const cash = totalAssets * (0.1 + rng() * 0.15);
      const totalDebt = totalLiabilities * (0.4 + rng() * 0.3);

      const operatingCashFlow = netIncome * (1.1 + rng() * 0.3);
      const capitalExpenditures = -(revenue * (0.03 + rng() * 0.07));
      const freeCashFlow = operatingCashFlow + capitalExpenditures;

      const periodEnd = new Date(now);
      if (periodType === "annual") {
        periodEnd.setFullYear(periodEnd.getFullYear() - i);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() - i * 3);
      }
      const fiscalYear = periodEnd.getFullYear();
      const fiscalQuarter = periodType === "quarterly" ? Math.floor(periodEnd.getMonth() / 3) + 1 : null;

      const filingDate = new Date(periodEnd);
      filingDate.setDate(filingDate.getDate() + 30 + Math.floor(rng() * 30));

      periods.push({
        source: "mock",
        ticker: ticker.toUpperCase(),
        periodType,
        fiscalYear,
        fiscalQuarter,
        reportingPeriodEnd: periodEnd.toISOString(),
        filingDate: filingDate.toISOString(),
        retrievedAt: new Date().toISOString(),
        reportedCurrency: "USD",
        revenue: round2(revenue),
        grossProfit: round2(grossProfit),
        operatingIncome: round2(operatingIncome),
        netIncome: round2(netIncome),
        eps: round2(eps),
        cash: round2(cash),
        totalAssets: round2(totalAssets),
        totalLiabilities: round2(totalLiabilities),
        totalDebt: round2(totalDebt),
        shareholdersEquity: round2(shareholdersEquity),
        operatingCashFlow: round2(operatingCashFlow),
        capitalExpenditures: round2(capitalExpenditures),
        freeCashFlow: round2(freeCashFlow),
      });
    }

    log.debug("generated mock financials", { ticker, periodType, count: periods.length });
    return { ok: true, data: periods };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
