/**
 * Minimal Alpaca market-data client for the backtest.
 *
 * Daily bars come from the SIP feed (all US exchanges -- the Phase 1 check
 * showed it matches FMP volume at 1.01x, while the free IEX feed is ~37x
 * too low), split- and dividend-adjusted. The free plan allows 200 calls a
 * minute; we stay under ~170.
 */

export interface AlpacaAsset {
  symbol: string;
  name: string;
  exchange: string;
  status: "active" | "inactive";
  class: string;
  tradable: boolean;
}

export type RawBar = [date: string, open: number, high: number, low: number, close: number, volume: number];

const DATA = "https://data.alpaca.markets/v2";
const TRADING = "https://paper-api.alpaca.markets/v2";
const MIN_INTERVAL_MS = 350;

export class AlpacaClient {
  private last = 0;
  constructor(private keyId: string, private secret: string) {}

  private async get(url: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { "APCA-API-KEY-ID": this.keyId, "APCA-API-SECRET-KEY": this.secret, accept: "application/json" },
        });
      } catch (e) {
        if (attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (res.status === 429) {
        console.log("  rate limited by Alpaca, waiting 60s...");
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      if (res.status >= 500 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`Alpaca HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    }
  }

  async assets(status: "active" | "inactive"): Promise<AlpacaAsset[]> {
    return (await this.get(`${TRADING}/assets?status=${status}&asset_class=us_equity`)) as AlpacaAsset[];
  }

  /** Daily bars for up to ~50 symbols at once, following pagination. */
  async dailyBars(symbols: string[], start: string, end: string): Promise<Map<string, RawBar[]>> {
    const out = new Map<string, RawBar[]>(symbols.map((s) => [s, []]));
    let token: string | undefined;
    do {
      const url =
        `${DATA}/stocks/bars?symbols=${encodeURIComponent(symbols.join(","))}` +
        `&timeframe=1Day&start=${start}&end=${end}&feed=sip&adjustment=all&limit=10000` +
        (token ? `&page_token=${encodeURIComponent(token)}` : "");
      const body = (await this.get(url)) as {
        bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]> | null;
        next_page_token: string | null;
      };
      for (const [sym, bars] of Object.entries(body.bars ?? {})) {
        const list = out.get(sym) ?? [];
        for (const b of bars) list.push([b.t.slice(0, 10), b.o, b.h, b.l, b.c, b.v]);
        out.set(sym, list);
      }
      token = body.next_page_token ?? undefined;
    } while (token);
    return out;
  }
}
