/**
 * Local price cache: one gzipped JSON file per symbol in <dataDir>/bars.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { DailySeries } from "../../src/lib/breakout/series";
import type { AlpacaClient, RawBar } from "./alpaca";

interface StoredFile {
  symbol: string;
  fetchedAt: string;
  start: string;
  end: string;
  bars: RawBar[];
}

/** First date requested from Alpaca for every symbol. */
export const START = "2016-01-01";

const fileFor = (dir: string, symbol: string) =>
  path.join(dir, "bars", `${symbol.replace(/[^A-Za-z0-9.-]/g, "_")}.json.gz`);

const round = (x: number) => Math.round(x * 10000) / 10000;

export function hasSymbol(dir: string, symbol: string): boolean {
  return fs.existsSync(fileFor(dir, symbol));
}

export function saveSymbol(dir: string, symbol: string, start: string, end: string, bars: RawBar[]): void {
  const file: StoredFile = {
    symbol,
    fetchedAt: new Date().toISOString(),
    start,
    end,
    bars: bars.map(([d, o, h, l, c, v]) => [d, round(o), round(h), round(l), round(c), v]),
  };
  fs.writeFileSync(fileFor(dir, symbol), zlib.gzipSync(JSON.stringify(file)));
}

export function loadSymbol(dir: string, symbol: string): DailySeries | null {
  const p = fileFor(dir, symbol);
  if (!fs.existsSync(p)) return null;
  const f = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8")) as StoredFile;
  const bars = [...f.bars].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    symbol,
    dates: bars.map((b) => b[0]),
    open: bars.map((b) => b[1]),
    high: bars.map((b) => b[2]),
    low: bars.map((b) => b[3]),
    close: bars.map((b) => b[4]),
    volume: bars.map((b) => b[5]),
  };
}

/** Make sure the given symbols are cached, downloading any that are missing. */
export async function ensureSymbols(
  client: AlpacaClient,
  dir: string,
  symbols: string[],
  start: string,
  end: string,
  refresh = false,
): Promise<void> {
  const missing = symbols.filter((s) => refresh || !hasSymbol(dir, s));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const got = await client.dailyBars(batch, start, end);
    for (const s of batch) saveSymbol(dir, s, start, end, got.get(s) ?? []);
  }
}

/**
 * End of the data request: the most recent midnight UTC (8pm New York in
 * summer, 7pm in winter), as a full timestamp.
 *  - The free plan rejects any request reaching into the last 15 minutes,
 *    so a bare date like "2026-10-20" fails late in the evening (Alpaca
 *    reads it as the whole day). A timestamp in the past never does.
 *  - It also keeps out today's still-forming bar when run during market
 *    hours: daily bars are stamped at midnight New York time, after this.
 */
export function dataEnd(now = Date.now()): string {
  const DAY = 86_400_000;
  let end = Math.floor(now / DAY) * DAY;
  if (now - end < 20 * 60_000) end -= DAY;
  return new Date(end).toISOString();
}
