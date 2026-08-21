import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsiderTransaction } from "@/lib/insider-trading-types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    insiderTransaction: { findMany: vi.fn(), upsert: vi.fn() },
    insiderTradingCacheEntry: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("./provider", () => ({
  insiderTradingProvider: { id: "mock", isMock: true, getInsiderTransactions: vi.fn() },
}));

const { prisma } = await import("@/server/db/client");
const { insiderTradingProvider } = await import("./provider");
const { getInsiderTransactions } = await import("./service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

function transaction(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    ticker: "AAPL",
    reportingName: "Cook Timothy D",
    role: "officer: CEO",
    transactionType: "sale",
    transactionDate: "2026-08-01T00:00:00.000Z",
    filingDate: "2026-08-03T00:00:00.000Z",
    shares: 50000,
    pricePerShare: 220,
    url: "https://www.sec.gov/example",
    provider: "mock",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("getInsiderTransactions", () => {
  it("calls the provider on a cache miss and persists via a transaction", async () => {
    (prisma.insiderTradingCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (insiderTradingProvider.getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [transaction()],
    });

    const result = await getInsiderTransactions("AAPL");

    expect(insiderTradingProvider.getInsiderTransactions).toHaveBeenCalledWith("AAPL", 30);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it("serves from the DB on a fresh, same-provider cache hit", async () => {
    (prisma.insiderTradingCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
      provider: "mock",
    });
    (prisma.insiderTransaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        reportingName: "Cook Timothy D",
        role: "officer: CEO",
        transactionType: "sale",
        transactionDate: new Date(),
        filingDate: new Date(),
        shares: 50000,
        pricePerShare: 220,
        url: "https://www.sec.gov/example",
        provider: "mock",
        retrievedAt: new Date(),
      },
    ]);

    const result = await getInsiderTransactions("AAPL");
    expect(insiderTradingProvider.getInsiderTransactions).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("calls the provider again when the cached entry came from a different provider", async () => {
    (prisma.insiderTradingCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
      provider: "fmp", // mismatch vs. mocked provider.id "mock"
    });
    (insiderTradingProvider.getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [transaction()],
    });

    await getInsiderTransactions("AAPL");
    expect(insiderTradingProvider.getInsiderTransactions).toHaveBeenCalled();
  });

  it("propagates a provider error without writing to the DB", async () => {
    (prisma.insiderTradingCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (insiderTradingProvider.getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await getInsiderTransactions("AAPL");
    expect(result.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching the provider or DB", async () => {
    const result = await getInsiderTransactions("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(insiderTradingProvider.getInsiderTransactions).not.toHaveBeenCalled();
  });
});
