import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar } from "@/lib/types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    watchlistItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    prediction: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/market-data/service", () => ({
  getHistoricalPrices: vi.fn(),
}));

const { prisma } = await import("@/server/db/client");
const { getHistoricalPrices } = await import("@/server/market-data/service");
const { addToWatchlist, removeFromWatchlist, listWatchlist, checkWatchlist, MAX_WATCHLIST_SIZE } = await import(
  "./service"
);

function row(ticker: string, id = `wl_${ticker}`) {
  return { id, ticker, notes: null, addedAt: new Date("2026-10-01T00:00:00Z"), stock: { name: `${ticker} Inc` } };
}

/** A path that satisfies all four conditions: long climb, sharp run-up,
 * then a flat stretch so the 63-day change falls back toward zero. */
function qualifyingBars(): PriceBar[] {
  const bars: PriceBar[] = [];
  const push = (count: number, from: number, to: number) => {
    for (let i = 0; i < count; i++) {
      const close = from + ((to - from) * i) / Math.max(1, count - 1);
      const d = new Date(Date.UTC(2024, 0, 1) + bars.length * 86_400_000);
      bars.push({ timestamp: d.toISOString(), open: close, high: close, low: close, close, volume: 1_000 });
    }
  };
  push(150, 100, 150);
  push(30, 150, 190);
  push(81, 190, 190.5);
  return bars;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("addToWatchlist", () => {
  it("normalizes the ticker to uppercase", async () => {
    (prisma.watchlistItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.watchlistItem.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "s1", ticker: "AAPL" });
    (prisma.watchlistItem.create as ReturnType<typeof vi.fn>).mockResolvedValue(row("AAPL"));

    const result = await addToWatchlist("  aapl  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.ticker).toBe("AAPL");
  });

  it("rejects input that isn't a ticker", async () => {
    const result = await addToWatchlist("not a ticker!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
  });

  it("rejects an empty ticker", async () => {
    const result = await addToWatchlist("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
  });

  it("refuses a duplicate rather than adding it twice", async () => {
    (prisma.watchlistItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(row("AAPL"));
    const result = await addToWatchlist("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ALREADY_ON_LIST");
    expect(prisma.watchlistItem.create).not.toHaveBeenCalled();
  });

  it("enforces the size cap, because each check costs one request per stock against a 250/day plan", async () => {
    (prisma.watchlistItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.watchlistItem.count as ReturnType<typeof vi.fn>).mockResolvedValue(MAX_WATCHLIST_SIZE);

    const result = await addToWatchlist("NVDA");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WATCHLIST_FULL");
      expect(result.error.message).toContain("250");
    }
    expect(prisma.watchlistItem.create).not.toHaveBeenCalled();
  });
});

describe("removeFromWatchlist", () => {
  it("reports a clear error when the row isn't there", async () => {
    (prisma.watchlistItem.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
    const result = await removeFromWatchlist("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("listWatchlist", () => {
  it("returns a typed error instead of throwing when the database is down", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const result = await listWatchlist();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DB_ERROR");
  });
});

describe("checkWatchlist", () => {
  it("evaluates every stock and counts the ones meeting all four conditions", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("AAPL"), row("MSFT")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: qualifyingBars() });

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(2);
    expect(result.data.qualifyingCount).toBe(2);
    expect(result.data.rows[0]!.evaluation.conditions).toHaveLength(4);
  });

  it("lets one bad ticker fail without taking the whole check down", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("AAPL"), row("BADTICKER")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockImplementation(async (ticker: string) =>
      ticker === "AAPL"
        ? { ok: true, data: qualifyingBars() }
        : { ok: false, error: { code: "INVALID_TICKER", message: "No data found." } }
    );

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(2);
    const bad = result.data.rows.find((r) => r.ticker === "BADTICKER")!;
    const good = result.data.rows.find((r) => r.ticker === "AAPL")!;
    expect(bad.error).toContain("No data found.");
    expect(bad.evaluation.qualifies).toBe(false);
    expect(good.evaluation.qualifies).toBe(true);
  });

  it("says so plainly when a stock has too little history, rather than failing it silently", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("NEWCO")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: qualifyingBars().slice(-30) });

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const r = result.data.rows[0]!;
    expect(r.evaluation.insufficientData).toBe(true);
    expect(r.error).toContain("history");
  });

  it("puts qualifying stocks first, then those closest to qualifying", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      row("DOWNTREND"),
      row("QUALIFIES"),
    ]);
    const downtrend: PriceBar[] = qualifyingBars().map((b, i, arr) => ({
      ...b,
      close: 300 - (i / arr.length) * 150,
      open: 300 - (i / arr.length) * 150,
    }));
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockImplementation(async (ticker: string) =>
      ticker === "QUALIFIES" ? { ok: true, data: qualifyingBars() } : { ok: true, data: downtrend }
    );

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows[0]!.ticker).toBe("QUALIFIES");
  });

  it("reports how many market-data requests the check could have cost", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("A"), row("B"), row("C")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: qualifyingBars() });

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.marketDataRequestsUsed).toBe(3);
  });

  it("attaches the latest stored forecast without generating one", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("AAPL")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: qualifyingBars() });
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      horizon: "3_month",
      predictionDate: new Date("2026-09-01T00:00:00Z"),
      expectedReturnPct: 7.2,
      aiRating: "Moderate Buy",
      confidenceScore: 64,
      priceAtPrediction: 180,
    });

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows[0]!.latestForecast?.expectedReturnPct).toBe(7.2);
  });

  it("survives a missing forecast table without failing the check", async () => {
    (prisma.watchlistItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row("AAPL")]);
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: qualifyingBars() });
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));

    const result = await checkWatchlist();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rows[0]!.latestForecast).toBeNull();
  });
});
