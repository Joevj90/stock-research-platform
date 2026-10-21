/**
 * Case-study validation run (Phase 2 milestone).
 *
 *   npm run backtest:cases
 *
 * Runs the breakout engine on the stocks from the hand analysis, plus
 * three delisted 2023 failures, and prints every trade next to what the
 * hand analysis found. The goal is to check the ENGINE, not the strategy:
 * ten hand-picked stocks, nine of them winners, cannot tell us whether the
 * rules have an edge. That takes the universe run (Phase 3), compared with
 * random entries.
 *
 * Downloads only the ~15 symbols it needs (about 1 minute), so it can run
 * before the full universe download.
 */

import fs from "node:fs";
import path from "node:path";
import { BREAKOUT_VARIANTS, withConfig } from "../../src/lib/breakout/config";
import { runSymbol, type Trade } from "../../src/lib/breakout/engine";
import { statsBy, tradeStats } from "../../src/lib/breakout/metrics";
import { buildIndexContext } from "../../src/lib/breakout/signals";
import type { DailySeries } from "../../src/lib/breakout/series";
import { AlpacaClient } from "./alpaca";
import { dataDir, loadEnv, pct, requireAlpacaKeys, resultsDir } from "./env";
import { START, ensureSymbols, loadSymbol, dataEnd } from "./store";

interface Case {
  symbol: string;
  /** Window the hand analysis covered. Trades whose entry falls inside
   * it count toward the case. */
  from: string;
  to: string;
  /** What the hand analysis (weekly bars, exits at the weekly close)
   * found, for side-by-side comparison. Daily rules will not match
   * exactly: entries here use the stricter daily Setup A/B/C definitions
   * and exits fill at the next open. */
  hand: string;
}

const CASES: Case[] = [
  { symbol: "NVDA", from: "2022-10-01", to: "2023-09-30", hand: "Leader off the Oct-2022 low; tight April-2023 base before the May earnings gap. 10-week exit not computed by hand." },
  { symbol: "PLTR", from: "2022-12-01", to: "2025-02-28", hand: "Repeated earnings gaps; Feb-2024 breakout from a 6-month base. 10-week exit not computed by hand." },
  { symbol: "SMCI", from: "2023-08-01", to: "2024-06-30", hand: "Breakout ~$34 (Jan-2024); 10-week exit week of 2024-04-08 at $89.85 => about +165%; avoided the collapse." },
  { symbol: "ASTS", from: "2024-03-01", to: "2024-12-31", hand: "Catalyst week close $4.54 (May-2024); 10-week exit week of 2024-09-23 at $25.32 => about +458%." },
  { symbol: "APP", from: "2023-01-01", to: "2025-02-28", hand: "May-2023 breakout; 10-week exit Oct-2023 at $38.52 (+79%), re-entries Jan-2024 and Aug-2024; two whipsaws of 16-19%." },
  { symbol: "CVNA", from: "2022-12-01", to: "2023-12-31", hand: "Jan-2023 squeeze entry ~breakeven (+4%); May-2023 catalyst entry, exit week of 2023-09-18 => about +369%." },
  { symbol: "TSLA", from: "2023-01-01", to: "2024-04-30", hand: "Two trades of about +4% each on a +194% move: the template failed here." },
  { symbol: "COIN", from: "2023-06-01", to: "2024-09-30", hand: "Nov-2023 breakout, exit Jan-2024 => about +41%; re-entry Feb-2024 => about +3%." },
  { symbol: "RKLB", from: "2024-04-01", to: "2025-12-31", hand: "Aug-2024 breakout $6.56, exit week of 2025-01-13 => about +266%; re-entries +31% and -8%." },
  { symbol: "MSTR", from: "2023-01-01", to: "2024-04-30", hand: "Not analyzed by hand; moves with Bitcoin." },
];
const FAILURES = ["BBBY", "SIVB", "FRC"];

function captureFor(series: DailySeries, c: Case, trades: Trade[]) {
  const idx = series.dates.map((d, i) => [d, i] as const).filter(([d]) => d >= c.from && d <= c.to).map(([, i]) => i);
  if (!idx.length) return null;
  let lowI = idx[0]!;
  for (const i of idx) if (series.low[i]! < series.low[lowI]!) lowI = i;
  let peakI = lowI;
  for (const i of idx) if (i >= lowI && series.high[i]! > series.high[peakI]!) peakI = i;
  const move = series.high[peakI]! / series.low[lowI]! - 1;
  const inWindow = trades.filter((t) => t.entryDate >= c.from && t.entryDate <= c.to);
  const strat = inWindow.reduce((acc, t) => acc * (1 + t.returnPct), 1) - 1;
  return {
    low: { date: series.dates[lowI]!, price: series.low[lowI]! },
    peak: { date: series.dates[peakI]!, price: series.high[peakI]! },
    lowToPeak: move,
    strategy: strat,
    tradesInWindow: inWindow.length,
  };
}

function fmtTrade(t: Trade): string {
  const rs = t.selloffStrength === null ? "" : t.selloffStrength ? "  RS:held-in-selloff" : "  RS:fell-with-index";
  return (
    `    ${t.setup}  signal ${t.signalDate}  buy ${t.entryDate} @ ${t.entryPrice.toFixed(2)}  stop ${t.stop.toFixed(2)}` +
    `  ->  ${t.exitReason.padEnd(8)} ${t.exitDate} @ ${t.exitPrice.toFixed(2)}  ${pct(t.returnPct).padStart(8)}  (${t.holdDays}d, ${t.tier})${rs}`
  );
}

async function main() {
  loadEnv();
  const { keyId, secret } = requireAlpacaKeys();
  const client = new AlpacaClient(keyId, secret);
  const dir = dataDir();
  const end = dataEnd();
  const symbols = [...CASES.map((c) => c.symbol), ...FAILURES, "SPY"];

  console.log("Making sure case-study data is downloaded...");
  await ensureSymbols(client, dir, symbols, START, end);

  const spy = loadSymbol(dir, "SPY");
  if (!spy?.dates.length) throw new Error("SPY data missing; cannot run.");
  const datasetEnd = spy.dates[spy.dates.length - 1]!;
  const index = buildIndexContext(spy);
  const series = new Map(symbols.map((s) => [s, loadSymbol(dir, s)] as const));

  const report: Record<string, unknown> = { ranAt: new Date().toISOString(), datasetEnd, variants: {} };
  const cfg = withConfig();

  // ---------- Default rules: every trade, per case ----------
  console.log(`\n=== DEFAULT RULES, data through ${datasetEnd} ===`);
  console.log("Setups: A = tight base breakout, B = first pullback, C = catalyst + volume (retest), R = MA reclaim re-entry\n");
  const defaultTrades: Trade[] = [];
  for (const c of CASES) {
    const s = series.get(c.symbol);
    if (!s?.dates.length) {
      console.log(`${c.symbol}: NO DATA\n`);
      continue;
    }
    const r = runSymbol(s, cfg, index, datasetEnd);
    defaultTrades.push(...r.trades);
    const cap = captureFor(s, c, r.trades);
    console.log(`${c.symbol}  (${r.signalCount} signals over all years, ${r.trades.length} trades)`);
    for (const t of r.trades.filter((t) => t.entryDate >= c.from && t.entryDate <= c.to)) console.log(fmtTrade(t));
    if (cap) {
      console.log(
        `    window ${c.from}..${c.to}: low ${cap.low.price.toFixed(2)} (${cap.low.date}) -> peak ${cap.peak.price.toFixed(2)} (${cap.peak.date}) = ${pct(cap.lowToPeak, 0)}`,
      );
      console.log(
        `    strategy in window: ${pct(cap.strategy)} from ${cap.tradesInWindow} trades = captured ${(
          (cap.strategy / cap.lowToPeak) * 100
        ).toFixed(0)}% of the low-to-peak move`,
      );
    }
    console.log(`    hand analysis: ${c.hand}\n`);
  }

  console.log("=== DELISTED FAILURES (checks the delisting and ticker-reuse handling) ===");
  for (const sym of FAILURES) {
    const s = series.get(sym);
    if (!s?.dates.length) {
      console.log(`${sym}: NO DATA`);
      continue;
    }
    const r = runSymbol(s, cfg, index, datasetEnd);
    console.log(`${sym}: data ${s.dates[0]} .. ${s.dates[s.dates.length - 1]}, ${r.segments} segment(s), ${r.trades.length} trades`);
    for (const t of r.trades) console.log(fmtTrade(t));
  }

  // ---------- Variants: one change at a time ----------
  console.log("\n=== VARIANTS (all case stocks, all years; each changes one rule from default) ===");
  console.log("variant                  trades  win%   avg     median  avgWin  avgLoss  PF    delisted");
  const allSymbols = [...CASES.map((c) => c.symbol), ...FAILURES];
  const variantResults: Record<string, unknown> = {};
  for (const [name, overrides] of Object.entries(BREAKOUT_VARIANTS)) {
    const vcfg = withConfig(overrides);
    const trades: Trade[] = [];
    for (const sym of allSymbols) {
      const s = series.get(sym);
      if (s?.dates.length) trades.push(...runSymbol(s, vcfg, index, datasetEnd).trades);
    }
    const st = tradeStats(trades);
    variantResults[name] = { stats: st, bySetup: statsBy(trades, (t) => t.setup), trades };
    console.log(
      `${name.padEnd(24)} ${String(st.closedTrades).padStart(6)}  ${(st.winRate * 100).toFixed(0).padStart(3)}%  ${pct(
        st.avgReturn,
      ).padStart(7)}  ${pct(st.medianReturn).padStart(7)}  ${pct(st.avgWin).padStart(7)}  ${pct(st.avgLoss).padStart(7)}  ${
        Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : "n/a"
      }  ${st.delistedTrades}`,
    );
  }
  report.variants = variantResults;

  const bySetup = statsBy(defaultTrades, (t) => t.setup);
  const byRs = statsBy(defaultTrades, (t) => (t.selloffStrength === null ? "no-selloff" : t.selloffStrength ? "held" : "fell"));
  console.log("\n=== DEFAULT RULES BY SETUP / BY SELLOFF STRENGTH (case stocks only) ===");
  for (const [k, st] of [...Object.entries(bySetup), ...Object.entries(byRs)]) {
    console.log(`  ${k.padEnd(11)} ${String(st.closedTrades).padStart(4)} closed  win ${(st.winRate * 100).toFixed(0)}%  avg ${pct(st.avgReturn)}  median ${pct(st.medianReturn)}`);
  }
  console.log(
    "\nReminder: these are hand-picked stocks, mostly winners. Nothing here measures an edge.\n" +
      "Send the saved report file to Claude to compare against the hand analysis.",
  );

  const out = path.join(resultsDir(), `cases-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Saved ${out}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(process.env.ALPACA_API_SECRET_KEY ?? "\u0000", "***"));
  process.exit(1);
});
