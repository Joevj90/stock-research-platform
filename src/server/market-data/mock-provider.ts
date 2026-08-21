import type { MarketDataProvider } from "./provider.interface";
import type { PriceBar, Quote, Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("market-data:mock");

/**
 * ⚠️ MOCK DATA PROVIDER — NOT REAL MARKET DATA ⚠️
 *
 * This provider exists so the application is fully runnable before a real
 * market-data API key is configured. It generates deterministic, seeded
 * pseudo-random numbers from the ticker string — it does NOT hardcode
 * anything about any specific company, so it produces plausible-looking
 * output for any ticker without pretending to know real facts about that
 * company.
 *
 * Every value this provider returns is wrapped with `isMock: true`
 * provenance one layer up (see `service.ts` / API routes) so the UI can —
 * and must — visibly label it as mock data. Do not remove that labeling
 * when wiring in a real provider.
 *
 * Set MARKET_DATA_PROVIDER=fmp (or another implemented provider) to use
 * real data instead.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

  async getCompanyName(ticker: string): Promise<Result<string>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    // We don't know the real company name — say so rather than inventing one.
    return { ok: true, data: `${ticker.toUpperCase()} (mock — name unknown)` };
  }

  async getQuote(ticker: string): Promise<Result<Quote>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    const rng = seededRng(ticker);
    const basePrice = 20 + rng() * 480; // $20–$500, deterministic per ticker
    const changePercent = (rng() - 0.5) * 6; // -3%..+3%
    const change = basePrice * (changePercent / 100);
    const previousClose = basePrice - change;
    const avgVolume = Math.floor(500_000 + rng() * 20_000_000);
    const week52Spread = basePrice * (0.2 + rng() * 0.3);

    const quote: Quote = {
      ticker: ticker.toUpperCase(),
      price: round2(basePrice),
      change: round2(change),
      changePercent: round2(changePercent),
      dayHigh: round2(basePrice * (1 + rng() * 0.015)),
      dayLow: round2(basePrice * (1 - rng() * 0.015)),
      previousClose: round2(previousClose),
      volume: Math.floor(500_000 + rng() * 20_000_000),
      marketCap: Math.floor(basePrice * (1_000_000 + rng() * 5_000_000_000)),
      week52High: round2(basePrice + week52Spread * rng()),
      week52Low: round2(Math.max(1, basePrice - week52Spread * rng())),
      avgVolume,
      asOf: new Date().toISOString(),
    };

    log.debug("generated mock quote", { ticker });
    return { ok: true, data: quote };
  }

  async getHistory(ticker: string, from: Date, to: Date): Promise<Result<PriceBar[]>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    const rng = seededRng(ticker);
    let price = 20 + rng() * 480;
    const bars: PriceBar[] = [];

    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));

    for (let i = 0; i <= days; i++) {
      const date = new Date(from);
      date.setDate(date.getDate() + i);
      if (date > to) break;

      // Simple random walk with mild drift, deterministic per ticker+day.
      const drift = (rng() - 0.48) * 0.02;
      price = Math.max(1, price * (1 + drift));

      const open = price * (1 + (rng() - 0.5) * 0.01);
      const close = price;
      const high = Math.max(open, close) * (1 + rng() * 0.008);
      const low = Math.min(open, close) * (1 - rng() * 0.008);
      const volume = Math.floor(500_000 + rng() * 20_000_000);

      bars.push({
        timestamp: date.toISOString(),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume,
      });
    }

    log.debug("generated mock history", { ticker, from, to, bars: bars.length });
    return { ok: true, data: bars };
  }
}

function validateTicker(ticker: string): Result<true> {
  if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
    return {
      ok: false,
      error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
    };
  }
  return { ok: true, data: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic PRNG seeded from a string (mulberry32), so the same ticker
 * always yields the same mock series within a run. */
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
