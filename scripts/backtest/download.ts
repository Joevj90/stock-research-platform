/**
 * Download daily bars for the whole backtest universe (Phase 2 data step).
 *
 *   npm run backtest:download              # everything not yet cached
 *   npm run backtest:download -- --limit 200   # a quick partial run
 *
 * Safe to stop (Ctrl+C) and re-run: symbols already saved are skipped.
 *
 * Universe = Alpaca's active AND inactive (delisted) US stocks on NYSE,
 * NASDAQ and NYSE American, minus ETFs, funds, warrants, rights, units,
 * preferreds and SPACs. Price and liquidity filters are NOT applied here;
 * the engine applies them on each signal day, using only data known then,
 * so a stock that later became large is not favoured in advance.
 */

import fs from "node:fs";
import path from "node:path";
import { AlpacaClient, type AlpacaAsset } from "./alpaca";
import { dataDir, loadEnv, requireAlpacaKeys } from "./env";
import { START, hasSymbol, saveSymbol, dataEnd } from "./store";
const EXCHANGES = new Set(["NYSE", "NASDAQ", "AMEX"]);
const EXCLUDE_NAME =
  /\b(ETF|ETN|Fund|Trust|Warrants?|Rights?|Units?|Preferred|Depositary|Notes|Debentures|Acquisition Corp|Acquisition Co)\b|%/i;

export function isCommonStock(a: AlpacaAsset): boolean {
  if (!EXCHANGES.has(a.exchange)) return false;
  if (!/^[A-Z]{1,5}$/.test(a.symbol)) return false; // drops BRK.B-style classes, /WS warrants etc.
  if (EXCLUDE_NAME.test(a.name ?? "")) return false;
  return true;
}

async function main() {
  loadEnv();
  const { keyId, secret } = requireAlpacaKeys();
  const client = new AlpacaClient(keyId, secret);
  const dir = dataDir();
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const end = dataEnd();

  console.log(`Saving data to ${dir}`);
  console.log("Fetching the list of active and delisted stocks from Alpaca...");
  const assets = [...(await client.assets("active")), ...(await client.assets("inactive"))];
  const universe = new Map<string, AlpacaAsset>();
  for (const a of assets) if (isCommonStock(a) && !universe.has(a.symbol)) universe.set(a.symbol, a);
  const symbols = [...universe.keys(), "SPY"].sort();
  const delisted = [...universe.values()].filter((a) => a.status === "inactive").length;
  fs.writeFileSync(
    path.join(dir, "universe.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), start: START, end, assets: [...universe.values()] }, null, 1),
  );
  console.log(`Universe: ${symbols.length} symbols (${delisted} delisted), after removing ETFs, funds, warrants, SPACs.`);

  const todo = symbols.filter((s) => !hasSymbol(dir, s)).slice(0, limit);
  console.log(`${symbols.length - todo.length} already saved, ${todo.length} to download.`);
  const t0 = Date.now();
  let done = 0;
  let empty = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const got = await client.dailyBars(batch, START, end);
    for (const s of batch) {
      const bars = got.get(s) ?? [];
      if (!bars.length) empty++;
      saveSymbol(dir, s, START, end, bars);
    }
    done += batch.length;
    const mins = (Date.now() - t0) / 60_000;
    const eta = (mins / done) * (todo.length - done);
    process.stdout.write(`\r  ${done}/${todo.length} symbols  (${mins.toFixed(1)} min, ~${eta.toFixed(0)} min left)   `);
  }
  console.log(`\nDone. ${empty} symbols had no bars since ${START} (delisted before then, or never traded).`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(process.env.ALPACA_API_SECRET_KEY ?? "\u0000", "***"));
  process.exit(1);
});
