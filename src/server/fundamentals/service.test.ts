import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    financials: { findMany: vi.fn(), upsert: vi.fn() },
    fundamentalsCacheEntry: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("./provider", () => ({
  fundamentalsProvider: {
    id: "mock",
    isMock: true,
    getFinancials: vi.fn(),
  },
}));

const { prisma } = await import("@/server/db/client");
const { fundamentalsProvider } = await import("./provider");
const { getFundamentals } = await import("./service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

function samplePeriod(fiscalYear: number, revenue: number): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear,
    fiscalQuarter: null,
    reportingPeriodEnd: `${fiscalYear}-09-30T00:00:00.000Z`,
    filingDate: `${fiscalYear}-10-30T00:00:00.000Z`,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue,
    grossProfit: revenue * 0.4,
    operatingIncome: revenue * 0.25,
    netIncome: revenue * 0.2,
    eps: 5,
    cash: revenue * 0.1,
    totalAssets: revenue * 2,
    totalLiabilities: revenue * 1.2,
    totalDebt: revenue * 0.5,
    shareholdersEquity: revenue * 0.8,
    operatingCashFlow: revenue * 0.22,
    capitalExpenditures: -revenue * 0.05,
    freeCashFlow: revenue * 0.17,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("getFundamentals", () => {
  it("calls the provider on a cache miss and persists via a transaction", async () => {
    (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fundamentalsProvider.getFinancials as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [samplePeriod(2025, 400e9), samplePeriod(2024, 380e9)], // provider returns most-recent-first
    });

    const result = await getFundamentals("AAPL", "annual");

    expect(fundamentalsProvider.getFinancials).toHaveBeenCalledWith("AAPL", "annual", 8);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.periods).toHaveLength(2);
      // stored/returned oldest-first
      expect(result.data.periods[0]!.period.fiscalYear).toBe(2024);
      expect(result.data.periods[1]!.period.fiscalYear).toBe(2025);
    }
  });

  it("serves from the DB on a fresh cache hit, without calling the provider", async () => {
    (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
      provider: "mock",
    });
    (prisma.financials.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        periodEnd: new Date("2024-09-30"),
        periodType: "annual",
        fiscalYear: 2024,
        fiscalQuarter: null,
        filingDate: new Date("2024-10-30"),
        reportedCurrency: "USD",
        provider: "fmp",
        retrievedAt: new Date(),
        revenue: 380e9,
        grossProfit: 152e9,
        operatingIncome: 95e9,
        netIncome: 76e9,
        eps: 5,
        cash: 38e9,
        totalAssets: 760e9,
        totalLiabilities: 456e9,
        totalDebt: 190e9,
        shareholdersEquity: 304e9,
        operatingCashFlow: 83.6e9,
        capitalExpenditures: -19e9,
        freeCashFlow: 64.6e9,
      },
    ]);

    const result = await getFundamentals("AAPL", "annual");

    expect(fundamentalsProvider.getFinancials).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.periods).toHaveLength(1);
      expect(result.data.periods[0]!.period.ticker).toBe("AAPL");
    }
  });

  it("attaches validation warnings and computed ratios to the result", async () => {
    (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fundamentalsProvider.getFinancials as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [samplePeriod(2025, 400e9)],
    });

    const result = await getFundamentals("AAPL", "annual");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.periods[0]!.warnings).toEqual([]); // internally-consistent sample data
      expect(result.data.ratios[0]!.grossMarginPct).toBeCloseTo(40, 5);
      expect(result.data.metricSeries.revenue.explanation).toBeTruthy();
    }
  });

  it("keeps annual and quarterly requests separately cached and fetched", async () => {
    (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fundamentalsProvider.getFinancials as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [samplePeriod(2025, 400e9)],
    });

    await getFundamentals("AAPL", "quarterly");

    expect(fundamentalsProvider.getFinancials).toHaveBeenCalledWith("AAPL", "quarterly", 12);
    const cacheCall = (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(cacheCall.where.stockId_periodType.periodType).toBe("quarterly");
  });

  it("propagates a provider error without writing to the DB", async () => {
    (prisma.fundamentalsCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fundamentalsProvider.getFinancials as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await getFundamentals("ZZZZZ", "annual");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching the provider or DB", async () => {
    const result = await getFundamentals("   ", "annual");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(fundamentalsProvider.getFinancials).not.toHaveBeenCalled();
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });
});
