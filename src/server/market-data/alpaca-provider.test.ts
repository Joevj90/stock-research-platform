import { afterEach, describe, expect, it, vi } from "vitest";
import { AlpacaMarketDataProvider, inRegularSession, lastCompletedDayEnd, nyDate } from "./alpaca-provider";

// Wednesday 2026-10-21, 11:00 New York (15:00 UTC): market open.
const MID_SESSION = Date.parse("2026-10-21T15:00:00Z");
// Saturday 2026-10-24, noon UTC: market closed.
const WEEKEND = Date.parse("2026-10-24T12:00:00Z");

type Route = (url: URL) => { status: number; body: unknown };

function stubFetch(route: Route) {
  const spy = vi.fn(async (input: string) => {
    const { status, body } = route(new URL(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const day = (date: string, c: number, extra: Partial<{ o: number; h: number; l: number; v: number }> = {}) => ({
  t: `${date}T04:00:00Z`,
  o: extra.o ?? c,
  h: extra.h ?? c + 1,
  l: extra.l ?? c - 1,
  c,
  v: extra.v ?? 1_000,
});

describe("AlpacaMarketDataProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires both keys", () => {
    expect(() => new AlpacaMarketDataProvider("", "x")).toThrow(/ALPACA_API_KEY_ID/);
    expect(() => new AlpacaMarketDataProvider("x", "")).toThrow(/ALPACA_API_KEY_ID/);
  });

  it("rejects malformed tickers without a network call", async () => {
    const spy = stubFetch(() => ({ status: 200, body: {} }));
    const r = await new AlpacaMarketDataProvider("k", "s").getHistory("bad ticker!", new Date(0), new Date());
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("daily history: SIP, adjusted, completed days only, midnight-UTC dates, follows pages", async () => {
    const urls: URL[] = [];
    stubFetch((u) => {
      urls.push(u);
      return u.searchParams.get("page_token")
        ? { status: 200, body: { bars: [day("2026-10-20", 12)], next_page_token: null } }
        : { status: 200, body: { bars: [day("2026-10-19", 11)], next_page_token: "abc" } };
    });
    const p = new AlpacaMarketDataProvider("k", "s", null, () => MID_SESSION);
    const r = await p.getHistory("rklb", new Date("2026-10-01T00:00:00Z"), new Date("2026-10-30T00:00:00Z"));
    expect(r.ok && r.data.map((b) => b.timestamp)).toEqual(["2026-10-19T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
    const first = urls[0]!;
    expect(first.pathname).toBe("/v2/stocks/RKLB/bars");
    expect(first.searchParams.get("feed")).toBe("sip");
    expect(first.searchParams.get("adjustment")).toBe("all");
    expect(first.searchParams.get("timeframe")).toBe("1Day");
    // Ends at midnight UTC today: today's unfinished bar is excluded.
    expect(first.searchParams.get("end")).toBe("2026-10-21T00:00:00.000Z");
    expect(urls[1]!.searchParams.get("page_token")).toBe("abc");
  });

  it("intraday history keeps only regular-session bars", async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        bars: [
          { t: "2026-10-20T12:00:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 }, // 8:00 NY, pre-market
          { t: "2026-10-20T13:30:00Z", o: 2, h: 2, l: 2, c: 2, v: 2 }, // 9:30 NY, open
          { t: "2026-10-20T19:55:00Z", o: 3, h: 3, l: 3, c: 3, v: 3 }, // 15:55 NY
          { t: "2026-10-20T20:00:00Z", o: 4, h: 4, l: 4, c: 4, v: 4 }, // 16:00 NY, after hours
        ],
        next_page_token: null,
      },
    }));
    const p = new AlpacaMarketDataProvider("k", "s", null, () => MID_SESSION);
    const r = await p.getIntradayHistory("AAPL", "5min", new Date("2026-10-20T00:00:00Z"), new Date());
    expect(r.ok && r.data.map((b) => b.close)).toEqual([2, 3]);
  });

  it("quote mid-session: live IEX price, SIP day stats, previous close from yesterday", async () => {
    stubFetch((u) => {
      if (u.pathname.endsWith("/snapshot")) {
        expect(u.searchParams.get("feed")).toBe("iex");
        return { status: 200, body: { latestTrade: { p: 31.5, t: "2026-10-21T14:59:30Z" } } };
      }
      return {
        status: 200,
        body: {
          bars: [
            day("2026-10-19", 28, { v: 900 }),
            day("2026-10-20", 30, { v: 1_100, h: 40 }),
            { t: "2026-10-21T04:00:00Z", o: 30.5, h: 31.2, l: 29.9, c: 31, v: 500 }, // today, partial
          ],
          next_page_token: null,
        },
      };
    });
    const r = await new AlpacaMarketDataProvider("k", "s", null, () => MID_SESSION).getQuote("RKLB");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.price).toBe(31.5);
    expect(r.data.previousClose).toBe(30);
    expect(r.data.change).toBeCloseTo(1.5);
    expect(r.data.changePercent).toBeCloseTo(5);
    expect(r.data.volume).toBe(500);
    expect(r.data.dayHigh).toBe(31.5); // live trade above the delayed SIP high
    expect(r.data.dayLow).toBe(29.9);
    expect(r.data.week52High).toBe(40);
    expect(r.data.avgVolume).toBe(1_000); // completed days only
    expect(r.data.marketCap).toBeNull();
  });

  it("quote on a weekend ignores after-hours IEX prints and uses the last close", async () => {
    stubFetch((u) =>
      u.pathname.endsWith("/snapshot")
        ? { status: 200, body: { latestTrade: { p: 99, t: "2026-10-23T23:00:00Z" } } } // Friday 19:00 NY
        : { status: 200, body: { bars: [day("2026-10-22", 20), day("2026-10-23", 22)], next_page_token: null } },
    );
    const r = await new AlpacaMarketDataProvider("k", "s", null, () => WEEKEND).getQuote("RKLB");
    expect(r.ok && r.data.price).toBe(22);
    expect(r.ok && r.data.previousClose).toBe(20);
  });

  it("maps provider errors to the app's error codes", async () => {
    const p = new AlpacaMarketDataProvider("k", "s", null, () => MID_SESSION);
    stubFetch(() => ({ status: 404, body: { message: "asset not found" } }));
    expect(await p.getCompanyName("ZZZZ")).toMatchObject({ ok: false, error: { code: "INVALID_TICKER" } });
    stubFetch(() => ({ status: 403, body: { message: "subscription does not permit querying recent SIP data" } }));
    expect(await p.getHistory("AAPL", new Date(0), new Date())).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED" },
    });
    stubFetch(() => ({ status: 401, body: { message: "unauthorized." } }));
    expect(await p.getQuote("AAPL")).toMatchObject({ ok: false, error: { code: "PROVIDER_AUTH_ERROR" } });
  });

  it("delegates peers to FMP when configured", async () => {
    const fmp = { getPeerSymbols: vi.fn(async () => ({ ok: true as const, data: ["MSFT"] })) };
    const r = await new AlpacaMarketDataProvider("k", "s", fmp).getPeerSymbols("AAPL", 5);
    expect(r).toEqual({ ok: true, data: ["MSFT"] });
  });
});

describe("Alpaca time helpers", () => {
  it("lastCompletedDayEnd is the latest midnight UTC at least 16 minutes ago", () => {
    expect(new Date(lastCompletedDayEnd(MID_SESSION)).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(new Date(lastCompletedDayEnd(Date.parse("2026-10-22T00:05:00Z"))).toISOString()).toBe(
      "2026-10-21T00:00:00.000Z",
    );
  });

  it("nyDate and the regular session follow New York time, including DST", () => {
    expect(nyDate(Date.parse("2026-10-21T03:00:00Z"))).toBe("2026-10-20"); // 23:00 NY the day before
    expect(inRegularSession("2026-12-01T14:30:00Z", "5min")).toBe(true); // 9:30 EST
    expect(inRegularSession("2026-12-01T14:25:00Z", "5min")).toBe(false);
    expect(inRegularSession("2026-12-01T14:00:00Z", "1hour")).toBe(true); // 9:00 hourly bar holds the open
  });
});

describe("AlpacaMarketDataProvider.getHistoryBatch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks for many symbols at once, follows pages, and groups bars by ticker", async () => {
    const urls: URL[] = [];
    stubFetch((u) => {
      urls.push(u);
      return u.searchParams.get("page_token")
        ? { status: 200, body: { bars: { AAPL: [day("2026-10-20", 2)] }, next_page_token: null } }
        : {
            status: 200,
            body: { bars: { AAPL: [day("2026-10-19", 1)], "BRK.B": [day("2026-10-19", 500)] }, next_page_token: "p2" },
          };
    });
    const p = new AlpacaMarketDataProvider("k", "s", null, () => MID_SESSION);
    const r = await p.getHistoryBatch(["aapl", "BRK.B", "bad ticker!"], new Date("2026-01-01T00:00:00Z"), new Date());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(urls[0]!.pathname).toBe("/v2/stocks/bars");
    expect(urls[0]!.searchParams.get("symbols")).toBe("AAPL,BRK.B"); // malformed ticker dropped
    expect(urls[0]!.searchParams.get("end")).toBe("2026-10-21T00:00:00.000Z"); // completed days only
    expect(r.data.get("AAPL")!.map((b) => b.close)).toEqual([1, 2]);
    expect(r.data.get("BRK.B")!.length).toBe(1);
  });
});
