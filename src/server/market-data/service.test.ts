import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar, Quote } from "@/lib/types";

// Mock the two things service.ts depends on: the Prisma client and the
// provider singleton. This lets us assert the cache-hit/cache-miss
// decision in isolation, without a real database or network call — and,
// implicitly, proves the service never reaches for anything other than
// these two seams (which is the whole point of the architectural
// boundary this module enforces).
vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    quote: { findFirst: vi.fn(), create: vi.fn() },
    priceBar: { findMany: vi.fn(), upsert: vi.fn() },
    marketDataCacheEntry: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("./provider", () => ({
  marketDataProvider: {
    id: "mock",
    isMock: true,
    getCompanyName: vi.fn(),
    getQuote: vi.fn(),
    getHistory: vi.fn(),
    getIntradayHistory: vi.fn(),
  },
}));

const { prisma } = await import("@/server/db/client");
const { marketDataProvider } = await import("./provider");
const { getQuote, getHistoricalPrices, getIntradayHistory } = await import("./service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

const SAMPLE_QUOTE: Quote = {
  ticker: "AAPL",
  price: 227.5,
  change: -1.25,
  changePercent: -0.55,
  dayHigh: 229.1,
  dayLow: 226.0,
  previousClose: 228.75,
  volume: 45_000_000,
  marketCap: 3_500_000_000_000,
  week52High: 260.1,
  week52Low: 164.0,
  avgVolume: 50_000_000,
  asOf: new Date().toISOString(),
};

const SAMPLE_BARS: PriceBar[] = [
  { timestamp: "2026-08-18T00:00:00.000Z", open: 224, high: 226, low: 223, close: 225, volume: 80 },
  { timestamp: "2026-08-19T00:00:00.000Z", open: 225, high: 228, low: 224, close: 227, volume: 90 },
];

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("getQuote", () => {
  it("calls the provider on a cache miss and persists the result", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (marketDataProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_QUOTE,
    });

    const result = await getQuote("AAPL");

    expect(marketDataProvider.getQuote).toHaveBeenCalledWith("AAPL");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.price).toBe(227.5);
  });

  it("serves from the DB on a fresh cache hit, without calling the provider", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(), // just now — well within the quote TTL
      provider: "mock",
    });
    (prisma.quote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      price: SAMPLE_QUOTE.price,
      change: SAMPLE_QUOTE.change,
      changePercent: SAMPLE_QUOTE.changePercent,
      dayHigh: SAMPLE_QUOTE.dayHigh,
      dayLow: SAMPLE_QUOTE.dayLow,
      previousClose: SAMPLE_QUOTE.previousClose,
      volume: SAMPLE_QUOTE.volume,
      marketCap: SAMPLE_QUOTE.marketCap,
      week52High: SAMPLE_QUOTE.week52High,
      week52Low: SAMPLE_QUOTE.week52Low,
      avgVolume: SAMPLE_QUOTE.avgVolume,
      retrievedAt: new Date(),
    });

    const result = await getQuote("AAPL");

    expect(marketDataProvider.getQuote).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.price).toBe(SAMPLE_QUOTE.price);
  });

  it("calls the provider again once a cache entry has gone stale", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago > 1min TTL
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: staleDate,
    });
    (marketDataProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_QUOTE,
    });

    await getQuote("AAPL");

    expect(marketDataProvider.getQuote).toHaveBeenCalled();
  });

  it("calls the provider again when the cached entry came from a different provider (regression: switching MARKET_DATA_PROVIDER must not silently serve stale data from the old provider)", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(), // fresh by time, but from a different provider
      provider: "fmp",
    });
    (marketDataProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_QUOTE,
    });

    await getQuote("AAPL"); // mocked marketDataProvider.id is "mock" here

    expect(marketDataProvider.getQuote).toHaveBeenCalled();
  });

  it("propagates a provider error without writing to the DB", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (marketDataProvider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await getQuote("ZZZZZ");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching the provider or DB", async () => {
    const result = await getQuote("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(marketDataProvider.getQuote).not.toHaveBeenCalled();
    expect(prisma.stock.upsert).not.toHaveBeenCalled();
  });
});

describe("getHistoricalPrices", () => {
  it("calls the provider on a cache miss and persists the bars", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (marketDataProvider.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_BARS,
    });

    const result = await getHistoricalPrices("AAPL", "1M");

    expect(marketDataProvider.getHistory).toHaveBeenCalledWith("AAPL", expect.any(Date), expect.any(Date));
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(2);
  });

  it("serves bars from the DB on a fresh cache hit, without calling the provider", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
      provider: "mock",
    });
    (prisma.priceBar.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        timestamp: new Date("2026-08-18"),
        open: 224,
        high: 226,
        low: 223,
        close: 225,
        volume: 80,
      },
    ]);

    const result = await getHistoricalPrices("AAPL", "1M");

    expect(marketDataProvider.getHistory).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it("falls back to the provider if the cache entry is fresh but the DB has no bars", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      retrievedAt: new Date(),
    });
    (prisma.priceBar.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (marketDataProvider.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_BARS,
    });

    const result = await getHistoricalPrices("AAPL", "1M");

    expect(marketDataProvider.getHistory).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("uses a distinct cache entry per period", async () => {
    (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (marketDataProvider.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_BARS,
    });

    await getHistoricalPrices("AAPL", "1Y");

    const call = (prisma.marketDataCacheEntry.findUnique as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.stockId_dataType_period.period).toBe("1Y");
    expect(call.where.stockId_dataType_period.dataType).toBe("historical");
  });
});

function intradayBar(iso: string, close: number) {
  return { timestamp: iso, open: close, high: close, low: close, close, volume: 1000 };
}

describe("getIntradayHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits a long range into several provider requests, since the provider truncates long ranges", async () => {
    (marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [intradayBar("2026-06-01T14:30:00.000Z", 100)],
    });

    await getIntradayHistory("AAPL", "5min", new Date("2026-06-01"), new Date("2026-08-30"));

    // ~90 days at 5-day chunks is far more than one call; the exact count
    // is an implementation detail, that it chunks at all is not.
    expect((marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(10);
  });

  it("returns bars oldest-first even when chunks resolve out of order", async () => {
    (marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, data: [intradayBar("2026-06-10T14:30:00.000Z", 102)] })
      .mockResolvedValue({ ok: true, data: [intradayBar("2026-06-01T14:30:00.000Z", 100)] });

    const result = await getIntradayHistory("AAPL", "5min", new Date("2026-06-01"), new Date("2026-06-12"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const times = result.data.map((b) => new Date(b.timestamp).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it("de-duplicates bars repeated across overlapping chunk boundaries", async () => {
    const duplicate = intradayBar("2026-06-05T14:30:00.000Z", 101);
    (marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [duplicate],
    });

    const result = await getIntradayHistory("AAPL", "5min", new Date("2026-06-01"), new Date("2026-06-20"));

    expect(result.ok).toBe(true);
    // Every chunk returned the same bar; it must appear exactly once, or
    // pattern sample sizes would be silently inflated.
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it("keeps partial data when some chunks fail rather than failing the whole range", async () => {
    (marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, error: { code: "PROVIDER_ERROR", message: "boom" } })
      .mockResolvedValue({ ok: true, data: [intradayBar("2026-06-08T14:30:00.000Z", 100)] });

    const result = await getIntradayHistory("AAPL", "5min", new Date("2026-06-01"), new Date("2026-06-20"));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.length).toBeGreaterThan(0);
  });

  it("surfaces an error when every chunk fails", async () => {
    (marketDataProvider.getIntradayHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_ERROR", message: "boom" },
    });

    const result = await getIntradayHistory("AAPL", "5min", new Date("2026-06-01"), new Date("2026-06-20"));
    expect(result.ok).toBe(false);
  });

  it("rejects a reversed date range", async () => {
    const result = await getIntradayHistory("AAPL", "5min", new Date("2026-06-20"), new Date("2026-06-01"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_DATE_RANGE");
  });
});
