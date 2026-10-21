import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar } from "@/lib/types";

vi.mock("@/server/db/client", () => ({
  prisma: { trendResetScan: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() } },
}));
vi.mock("@/server/market-data/service", () => ({ getDailyHistoryBatch: vi.fn() }));
vi.mock("@/data/sp500-tickers", () => ({ SP500_TICKERS: ["AAA", "BBB", "CCC", "DDD"] }));

const { prisma } = await import("@/server/db/client");
const { getDailyHistoryBatch } = await import("@/server/market-data/service");
const { runScanBatch, totalBatches } = await import("./service");

const bars = (n: number): PriceBar[] =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString(),
    open: 10,
    high: 10,
    low: 10,
    close: 10,
    volume: 1,
  }));

const scanRow = {
  id: "s1",
  startedAt: new Date("2026-10-21T14:00:00Z"),
  completedAt: null,
  totalBatches: 1,
  batchesDone: 0,
  asOfDate: null,
  evaluated: 0,
  rowsJson: "[]",
  skippedJson: "[]",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.trendResetScan.findUnique).mockResolvedValue(scanRow as never);
  vi.mocked(prisma.trendResetScan.update).mockImplementation((async (args: { data: object }) => ({
    ...scanRow,
    ...args.data,
  })) as never);
});

describe("runScanBatch", () => {
  it("one batch covers the (mocked) four-stock universe", () => {
    expect(totalBatches()).toBe(1);
  });

  it("splits a rejected batch so one bad symbol only loses itself", async () => {
    vi.mocked(getDailyHistoryBatch).mockImplementation(async (tickers: string[]) =>
      tickers.includes("CCC")
        ? { ok: false as const, error: { code: "INVALID_TICKER", message: "bad symbol" } }
        : { ok: true as const, data: new Map(tickers.map((t) => [t, bars(260)])) },
    );
    const r = await runScanBatch("s1", 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.skipped).toEqual([{ ticker: "CCC", reason: "bad symbol" }]);
    expect(r.data.evaluated).toBe(3); // AAA, BBB, DDD evaluated (flat prices: none qualify)
    expect(r.data.completedAt).not.toBeNull(); // last batch marks the scan complete
  });

  it("stops instead of splitting when the provider cannot batch at all", async () => {
    vi.mocked(getDailyHistoryBatch).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_UNSUPPORTED", message: "Set MARKET_DATA_PROVIDER=alpaca." },
    });
    const r = await runScanBatch("s1", 0);
    expect(r).toMatchObject({ ok: false, error: { code: "PROVIDER_UNSUPPORTED" } });
    expect(getDailyHistoryBatch).toHaveBeenCalledTimes(1);
  });

  it("rejects an out-of-range batch number", async () => {
    expect(await runScanBatch("s1", 5)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  });
});
