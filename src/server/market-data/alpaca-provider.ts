import type { MarketDataProvider } from "./provider.interface";
import type { IntradayInterval, PriceBar, Quote, Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("market-data:alpaca");

const DATA_URL = "https://data.alpaca.markets/v2";
// Asset lookups (company name, does this ticker exist) live on the trading
// API. The paper-trading host serves them for a data-only paper account;
// nothing here ever places an order.
const TRADING_URL = "https://paper-api.alpaca.markets/v2";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
/** The free plan rejects any request that reaches into the last 15
 * minutes of consolidated (SIP) data. Stay a little further back. */
const SIP_DELAY_MS = 16 * 60_000;

/**
 * Alpaca market-data provider (added Oct 2026).
 *
 * WHY: the app ran on FMP, and FMP's free plan only serves prices for a
 * sample of ~87 large stocks -- RKLB, ASTS, SMCI and most of the market
 * return HTTP 402, so their dashboards and the Trend Reset watchlist
 * broke. Alpaca's free data plan serves daily and intraday bars for every
 * US stock. A side-by-side check on 2026-10-20 found its consolidated
 * (SIP) daily volume matched FMP's at 1.01x over 20 days, while its free
 * real-time IEX feed shows only ~1/37th of the volume, so volume always
 * comes from SIP here.
 *
 * WHAT THE FREE PLAN CANNOT DO, and how this class handles it:
 *  - SIP data from the last 15 minutes is off limits, so every SIP
 *    request ends at least 16 minutes in the past.
 *  - Real-time prices come only from IEX (one exchange). The quote's
 *    price uses the latest IEX trade when it is newer than the delayed
 *    SIP data; day high/low/volume always come from SIP, up to 16 minutes
 *    old.
 *  - Alpaca has no market cap or peer data. Market cap is null; peers are
 *    delegated to FMP when a key is configured (FMP's peers endpoint needs
 *    a paid plan, so expect that to fail on the free plan).
 *
 * Daily bars are split- and dividend-adjusted and stamped at midnight UTC
 * of the trading date, the same convention the FMP provider uses, so a
 * provider switch does not create duplicate rows for the same day.
 * Only COMPLETED trading days are returned as daily bars; today's
 * unfinished bar is excluded so a mid-session price is never mistaken for
 * a close (the Trend Reset rules were tested on closes).
 */
export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly id = "alpaca" as const;
  readonly isMock = false;

  constructor(
    private readonly keyId: string,
    private readonly secret: string,
    private readonly peerFallback: Pick<MarketDataProvider, "getPeerSymbols"> | null = null,
    private readonly now: () => number = Date.now,
  ) {
    if (!keyId || !secret) {
      throw new Error(
        "AlpacaMarketDataProvider requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY. " +
          "Create them in the Alpaca paper-trading dashboard (no deposit needed).",
      );
    }
  }

  async getCompanyName(ticker: string): Promise<Result<string>> {
    const v = validateTicker(ticker);
    if (!v.ok) return v;
    const r = await this.fetchJson<{ name?: string; symbol: string }>(
      `${TRADING_URL}/assets/${encodeURIComponent(ticker.toUpperCase())}`,
      {},
      ticker,
    );
    if (!r.ok) return r;
    return { ok: true, data: r.data.name || ticker.toUpperCase() };
  }

  async getHistory(ticker: string, from: Date, to: Date): Promise<Result<PriceBar[]>> {
    const v = validateTicker(ticker);
    if (!v.ok) return v;
    const end = Math.min(to.getTime(), lastCompletedDayEnd(this.now()));
    if (end <= from.getTime()) return { ok: true, data: [] };
    const r = await this.bars(ticker, "1Day", new Date(from), new Date(end));
    if (!r.ok) return r;
    if (r.data.length === 0) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `No historical data found for ticker "${ticker}".` },
      };
    }
    return { ok: true, data: r.data.map(toDailyBar) };
  }

  async getIntradayHistory(
    ticker: string,
    interval: IntradayInterval,
    from: Date,
    to: Date,
  ): Promise<Result<PriceBar[]>> {
    const v = validateTicker(ticker);
    if (!v.ok) return v;
    const end = Math.min(to.getTime(), this.now() - SIP_DELAY_MS);
    if (end <= from.getTime()) return { ok: true, data: [] };
    const r = await this.bars(ticker, INTERVALS[interval], new Date(from), new Date(end));
    if (!r.ok) return r;
    // Alpaca includes pre- and after-market bars. The app sizes intraday
    // windows in regular-session bars (BARS_PER_TRADING_DAY: 78 five-minute
    // bars a day), so keep only bars inside 9:30-16:00 New York time.
    const regular = r.data.filter((b) => inRegularSession(b.t, interval));
    return {
      ok: true,
      data: regular.map((b) => ({ timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })),
    };
  }

  async getQuote(ticker: string): Promise<Result<Quote>> {
    const v = validateTicker(ticker);
    if (!v.ok) return v;
    const sym = ticker.toUpperCase();
    const now = this.now();

    // ~13 months of SIP daily bars, ending 16 minutes ago. The last bar may
    // be today's still-forming one (delayed, but SIP = all exchanges).
    const yearAgo = new Date(now - 400 * 86_400_000);
    const daily = await this.bars(sym, "1Day", yearAgo, new Date(now - SIP_DELAY_MS));
    if (!daily.ok) return daily;
    if (daily.data.length === 0) {
      return { ok: false, error: { code: "INVALID_TICKER", message: `No quote data found for ticker "${ticker}".` } };
    }

    // Latest IEX trade: real time, but one exchange. Only used for price,
    // never for volume. Failure here is not fatal.
    const snap = await this.fetchJson<{ latestTrade?: { p: number; t: string } }>(
      `${DATA_URL}/stocks/${encodeURIComponent(sym)}/snapshot`,
      { feed: "iex" },
      ticker,
    );

    const bars = daily.data;
    const today = nyDate(now);
    const last = bars[bars.length - 1]!;
    const lastIsToday = last.t.slice(0, 10) === today;
    const completed = lastIsToday ? bars.slice(0, -1) : bars;
    const prevBar = completed[completed.length - 1];
    const dayBar = lastIsToday ? last : null;

    let price = dayBar ? dayBar.c : last.c;
    let asOf = dayBar ? new Date(now - SIP_DELAY_MS).toISOString() : last.t;
    const trade = snap.ok ? snap.data.latestTrade : undefined;
    // Only use the IEX trade during today's regular session; outside it the
    // last IEX print can be an after-hours trade, not the close.
    const tradeUsable =
      trade && typeof trade.p === "number" && nyDate(Date.parse(trade.t)) === today && inRegularSession(trade.t, "1min");
    if (trade && tradeUsable && Date.parse(trade.t) > Date.parse(asOf)) {
      price = trade.p;
      asOf = trade.t;
    }
    const previousClose = dayBar ? (prevBar?.c ?? dayBar.o) : (completed[completed.length - 2]?.c ?? last.o);
    const recent = bars.slice(-252);
    const volWindow = completed.slice(-63);

    const quote: Quote = {
      ticker: sym,
      price,
      change: price - previousClose,
      changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
      dayHigh: dayBar ? Math.max(dayBar.h, price) : last.h,
      dayLow: dayBar ? Math.min(dayBar.l, price) : last.l,
      previousClose,
      volume: dayBar ? dayBar.v : last.v,
      marketCap: null,
      week52High: Math.max(...recent.map((b) => b.h), price),
      week52Low: Math.min(...recent.map((b) => b.l), price),
      // Three-month (63 trading day) average of completed days, SIP volume.
      avgVolume: volWindow.length ? volWindow.reduce((s, b) => s + b.v, 0) / volWindow.length : null,
      asOf,
    };
    return { ok: true, data: quote };
  }

  /**
   * Completed daily bars for many tickers in as few requests as possible
   * (Alpaca accepts a list of symbols per request). Used by the Trend
   * Reset S&P 500 scan: ~50 tickers x ~280 bars is two requests, where
   * fetching one ticker at a time would take fifty.
   *
   * Tickers Alpaca has no bars for are simply absent from the result.
   */
  async getHistoryBatch(tickers: string[], from: Date, to: Date): Promise<Result<Map<string, PriceBar[]>>> {
    const symbols = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => validateTicker(t).ok);
    const out = new Map<string, PriceBar[]>();
    if (!symbols.length) return { ok: true, data: out };
    const end = Math.min(to.getTime(), lastCompletedDayEnd(this.now()));
    if (end <= from.getTime()) return { ok: true, data: out };
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES * 5; page++) {
      const params: Record<string, string> = {
        symbols: symbols.join(","),
        timeframe: "1Day",
        start: from.toISOString(),
        end: new Date(end).toISOString(),
        feed: "sip",
        adjustment: "all",
        limit: "10000",
      };
      if (token) params.page_token = token;
      const r = await this.fetchJson<{ bars: Record<string, AlpacaBar[]> | null; next_page_token: string | null }>(
        `${DATA_URL}/stocks/bars`,
        params,
        symbols.join(","),
      );
      if (!r.ok) return r;
      for (const [sym, bars] of Object.entries(r.data.bars ?? {})) {
        const list = out.get(sym) ?? [];
        for (const b of bars) list.push(toDailyBar(b));
        out.set(sym, list);
      }
      token = r.data.next_page_token ?? undefined;
      if (!token) break;
    }
    for (const list of out.values()) list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    return { ok: true, data: out };
  }

  async getPeerSymbols(ticker: string, limit: number): Promise<Result<string[]>> {
    if (this.peerFallback) return this.peerFallback.getPeerSymbols(ticker, limit);
    return {
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "Peer companies are not available from the price provider." },
    };
  }

  // ---------------------------------------------------------------------

  private async bars(
    ticker: string,
    timeframe: string,
    from: Date,
    to: Date,
  ): Promise<Result<AlpacaBar[]>> {
    const out: AlpacaBar[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = {
        timeframe,
        start: from.toISOString(),
        end: to.toISOString(),
        feed: "sip",
        adjustment: "all",
        limit: "10000",
      };
      if (token) params.page_token = token;
      const r = await this.fetchJson<{ bars: AlpacaBar[] | null; next_page_token: string | null }>(
        `${DATA_URL}/stocks/${encodeURIComponent(ticker.toUpperCase())}/bars`,
        params,
        ticker,
      );
      if (!r.ok) return r;
      out.push(...(r.data.bars ?? []));
      token = r.data.next_page_token ?? undefined;
      if (!token) break;
    }
    return { ok: true, data: out };
  }

  private async fetchJson<T>(base: string, params: Record<string, string>, ticker: string): Promise<Result<T>> {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { "APCA-API-KEY-ID": this.keyId, "APCA-API-SECRET-KEY": this.secret, accept: "application/json" },
      });
      if (res.ok) return { ok: true, data: (await res.json()) as T };

      let message = "";
      try {
        const body = (await res.json()) as { message?: string };
        message = body?.message ?? "";
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 404 || res.status === 422) {
        return {
          ok: false,
          error: { code: "INVALID_TICKER", message: `"${ticker.toUpperCase()}" was not found by the price provider.` },
        };
      }
      if (res.status === 403 && /subscription|permit/i.test(message)) {
        log.warn("Alpaca plan does not allow this request", { path: url.pathname, message });
        return {
          ok: false,
          error: { code: "PROVIDER_PLAN_REQUIRED", message: `Price provider plan does not allow this request (${message}).` },
        };
      }
      if (res.status === 401 || res.status === 403) {
        log.error("Alpaca authentication failed -- check ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY", { status: res.status });
        return { ok: false, error: { code: "PROVIDER_AUTH_ERROR", message: "Market data provider rejected the API key." } };
      }
      if (res.status === 429) {
        log.warn("Alpaca rate limit hit");
        return { ok: false, error: { code: "PROVIDER_RATE_LIMITED", message: "Market data provider rate limit exceeded." } };
      }
      log.error("Alpaca request failed", { status: res.status, path: url.pathname, message });
      return { ok: false, error: { code: "PROVIDER_ERROR", message: `Market data provider returned ${res.status}.` } };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      log.error("Alpaca request threw", { path: url.pathname, error: err instanceof Error ? err.message : String(err) });
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

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const INTERVALS: Record<IntradayInterval, string> = {
  "1min": "1Min",
  "5min": "5Min",
  "15min": "15Min",
  "30min": "30Min",
  "1hour": "1Hour",
};

function validateTicker(ticker: string): Result<true> {
  if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
    return { ok: false, error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` } };
  }
  return { ok: true, data: true };
}

/** Daily bars are labelled by Alpaca at midnight New York time; the app
 * stores daily bars at midnight UTC of the trading date. */
function toDailyBar(b: AlpacaBar): PriceBar {
  return { timestamp: `${nyDate(Date.parse(b.t))}T00:00:00.000Z`, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
}

const nyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyParts(ms: number): { date: string; minutes: number } {
  const p = Object.fromEntries(nyFormatter.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Trading date (YYYY-MM-DD) in New York for a timestamp. */
export function nyDate(ms: number): string {
  return nyParts(ms).date;
}

/**
 * End of the last COMPLETED trading day's data: midnight UTC of the
 * current UTC date, unless that is less than the SIP delay ago. Daily bars
 * are labelled at midnight New York time, which is after midnight UTC, so
 * today's unfinished bar is never included.
 */
export function lastCompletedDayEnd(now: number): number {
  const DAY = 86_400_000;
  let end = Math.floor(now / DAY) * DAY;
  if (now - end < SIP_DELAY_MS) end -= DAY;
  return end;
}

/** Regular session = bars starting 9:30-15:59 New York time. Hourly bars
 * are aligned to the hour, so the 9:00 bar (which holds the 9:30 open) is
 * kept for them. */
export function inRegularSession(iso: string, interval: IntradayInterval): boolean {
  const { minutes } = nyParts(Date.parse(iso));
  const open = interval === "1hour" ? 9 * 60 : 9 * 60 + 30;
  return minutes >= open && minutes < 16 * 60;
}
