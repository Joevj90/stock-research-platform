import type { MarketDataProvider } from "./provider.interface";
import type { PriceBar, Quote, Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("market-data:fmp");

// FMP retired the legacy /api/v3/ surface for new accounts in favor of a
// flatter /stable/ API (different base path, and historical data returns
// a plain array instead of a {historical: [...]} wrapper).
const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 10_000;

export class FmpMarketDataProvider implements MarketDataProvider {
  readonly id = "fmp" as const;
  readonly isMock = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "FmpMarketDataProvider requires FMP_API_KEY to be set. Get a free key at " +
          "https://site.financialmodelingprep.com/ and set it in your .env file."
      );
    }
  }

  async getCompanyName(ticker: string): Promise<Result<string>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    const result = await this.fetchJson<FmpQuoteResponse[]>("/quote", { symbol: ticker });
    if (!result.ok) return result;

    const row = result.data[0];
    if (!row) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `No data found for ticker "${ticker}".` },
      };
    }

    return { ok: true, data: row.name ?? ticker.toUpperCase() };
  }

  async getQuote(ticker: string): Promise<Result<Quote>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    const result = await this.fetchJson<FmpQuoteResponse[]>("/quote", { symbol: ticker });
    if (!result.ok) return result;

    const row = result.data[0];
    if (!row || typeof row.price !== "number") {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `No quote data found for ticker "${ticker}".` },
      };
    }

    const quote: Quote = {
      ticker: ticker.toUpperCase(),
      price: row.price,
      change: row.change ?? 0,
      changePercent: row.changePercentage ?? row.changesPercentage ?? 0,
      dayHigh: row.dayHigh ?? row.price,
      dayLow: row.dayLow ?? row.price,
      previousClose: row.previousClose ?? row.price,
      volume: row.volume ?? 0,
      marketCap: row.marketCap ?? null,
      week52High: row.yearHigh ?? null,
      week52Low: row.yearLow ?? null,
      avgVolume: row.avgVolume ?? null,
      asOf: new Date().toISOString(),
    };

    return { ok: true, data: quote };
  }

  async getHistory(ticker: string, from: Date, to: Date): Promise<Result<PriceBar[]>> {
    const validation = validateTicker(ticker);
    if (!validation.ok) return validation;

    const result = await this.fetchJson<FmpHistoricalRow[] | { symbol: string }>(
      "/historical-price-eod/full",
      { symbol: ticker, from: toDateStr(from), to: toDateStr(to) }
    );
    if (!result.ok) return result;

    if (!Array.isArray(result.data) || result.data.length === 0) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `No historical data found for ticker "${ticker}".` },
      };
    }

    const bars: PriceBar[] = result.data
      .map((r) => ({
        timestamp: new Date(r.date).toISOString(),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }))
      .reverse();

    return { ok: true, data: bars };
  }

  private async fetchJson<T>(
    path: string,
    extraParams: Record<string, string> = {}
  ): Promise<Result<T>> {
    const url = new URL(`${FMP_BASE_URL}${path}`);
    url.searchParams.set("apikey", this.apiKey);
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });

      if (res.status === 401 || res.status === 403) {
        log.error("FMP authentication failed — check FMP_API_KEY", { status: res.status });
        return {
          ok: false,
          error: { code: "PROVIDER_AUTH_ERROR", message: "Market data provider rejected the API key." },
        };
      }
      if (res.status === 429) {
        log.warn("FMP rate limit hit");
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

      return { ok: true, data: json as T };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      log.error("FMP request threw", { path, error: err instanceof Error ? err.message : String(err) });
      return {
        ok: false,
        error: {
          code: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
          message: isAbort
            ? "Market data provider timed out."
            : "Could not reach the market data provider.",
        },
      };
    } finally {
      clearTimeout(timeout);
    }
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

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface FmpQuoteResponse {
  symbol: string;
  name?: string;
  price?: number;
  change?: number;
  changePercentage?: number;
  changesPercentage?: number;
  dayHigh?: number;
  dayLow?: number;
  previousClose?: number;
  volume?: number;
  avgVolume?: number;
  marketCap?: number;
  yearHigh?: number;
  yearLow?: number;
}

interface FmpHistoricalRow {
  symbol?: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}