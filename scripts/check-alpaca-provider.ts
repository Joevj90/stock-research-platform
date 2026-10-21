/**
 * Live check of the Alpaca price provider, run on your own computer
 * BEFORE switching the website over:
 *
 *   npm run check:alpaca
 *
 * Uses the Alpaca keys in .env.local. Makes about 12 requests. Changes
 * nothing anywhere: it only reads prices and prints what the website
 * would show.
 */

import { loadEnv } from "./backtest/env";

async function main() {
  loadEnv();
  // The provider imports the app's logger, which validates the app's
  // config on import. Satisfy it; nothing here touches a database.
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  const { AlpacaMarketDataProvider } = await import("../src/server/market-data/alpaca-provider");

  const keyId = process.env.ALPACA_API_KEY_ID ?? "";
  const secret = process.env.ALPACA_API_SECRET_KEY ?? "";
  const p = new AlpacaMarketDataProvider(keyId, secret);
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 366 * 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  let failures = 0;

  for (const t of ["RKLB", "AAPL", "ASTS"]) {
    const name = await p.getCompanyName(t);
    const quote = await p.getQuote(t);
    const hist = await p.getHistory(t, yearAgo, now);
    const intra = await p.getIntradayHistory(t, "5min", weekAgo, now);
    console.log(`\n${t}: ${name.ok ? name.data : `NAME FAILED: ${name.error.message}`}`);
    if (quote.ok) {
      const q = quote.data;
      console.log(
        `  quote: $${q.price.toFixed(2)}  change ${q.change >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%  ` +
          `prev close $${q.previousClose.toFixed(2)}  52w $${q.week52Low?.toFixed(2)}-$${q.week52High?.toFixed(2)}  ` +
          `avg vol ${Math.round(q.avgVolume ?? 0).toLocaleString()}  as of ${q.asOf}`,
      );
    } else console.log(`  QUOTE FAILED: ${quote.error.message}`);
    if (hist.ok) {
      const b = hist.data;
      console.log(`  daily bars: ${b.length} (${b[0]?.timestamp.slice(0, 10)} to ${b[b.length - 1]?.timestamp.slice(0, 10)})`);
    } else console.log(`  DAILY FAILED: ${hist.error.message}`);
    if (intra.ok) console.log(`  5-min bars, last week, regular hours only: ${intra.data.length}`);
    else console.log(`  INTRADAY FAILED: ${intra.error.message}`);
    failures += [name, quote, hist, intra].filter((r) => !r.ok).length;
  }
  console.log(failures ? `\n${failures} request(s) failed. Send this output to Claude.` : "\nAll checks passed.");
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(process.env.ALPACA_API_SECRET_KEY || "\u0000", "***"));
  process.exit(1);
});
