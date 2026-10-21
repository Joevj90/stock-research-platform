/**
 * Phase 3: the universe backtest.
 *
 *   npm run backtest:universe
 *   npm run backtest:universe -- --limit 500     (quick partial run)
 *
 * Needs the data from `npm run backtest:download`.
 *
 * What it answers, per variant (each changes one rule from the default):
 *  1. Do the strategy's trades beat RANDOM trades -- a different eligible
 *     stock of the same liquidity tier, bought the same day with the same
 *     stop distance and the same exits? This isolates the entry signal.
 *     Reported per trade, with a t-statistic clustered by month.
 *  2. As a portfolio (10 equal slots), what return and drawdown would the
 *     trades have produced, compared with the same portfolio built from
 *     the random trades and with holding SPY?
 *
 * Two passes over the data, one symbol at a time, so ~10,000 ten-year
 * histories never have to sit in memory together:
 *   Pass 1: run every variant on every stock; record trades and which
 *           stocks were eligible (and in which tier) on each day.
 *   Pass 2: draw random control stocks for every trade and run the same
 *           exits on them.
 */

import fs from "node:fs";
import path from "node:path";
import { edgeVsControl, type EdgeResult, type PairedTrade, seededRandom } from "../../src/lib/breakout/compare";
import { BREAKOUT_VARIANTS, type BreakoutConfig, type LiquidityTier, withConfig } from "../../src/lib/breakout/config";
import { runSymbol, simulateFromEntry, type Trade } from "../../src/lib/breakout/engine";
import { statsBy, tradeStats, type TradeStats } from "../../src/lib/breakout/metrics";
import { cagr, maxDrawdown, type PortfolioResult, type PortfolioTrade, simulatePortfolio } from "../../src/lib/breakout/portfolio";
import { type DailySeries, type Segment, splitOnGaps, type WeeklyView, weeklyView } from "../../src/lib/breakout/series";
import { buildIndexContext, eligibilityByDay } from "../../src/lib/breakout/signals";
import { dataDir, loadEnv, pct, resultsDir } from "./env";
import { loadSymbol } from "./store";

// ---------------- options ----------------
const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = arg("limit", Infinity);
const DRAWS = arg("draws", 5);
const SLOTS = arg("slots", 10);
const EVAL_START = "2016-07-01"; // first ~6 months are warm-up for the indicators
const TIERS: LiquidityTier[] = ["large", "mid", "small"];

// ---------------- helpers ----------------
function clean(s: DailySeries): DailySeries {
  const keep: number[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const o = s.open[i]!, h = s.high[i]!, l = s.low[i]!, c = s.close[i]!;
    if (o > 0 && h > 0 && l > 0 && c > 0 && h >= l && s.volume[i]! >= 0) keep.push(i);
  }
  const pick = <T>(a: T[]) => keep.map((i) => a[i]!);
  return {
    symbol: s.symbol,
    dates: pick(s.dates),
    open: pick(s.open),
    high: pick(s.high),
    low: pick(s.low),
    close: pick(s.close),
    volume: pick(s.volume),
  };
}

/** A trade plus what pass 2 and the portfolio need. */
interface Rec {
  trade: Trade;
  stopPct: number;
  calIdx: Int32Array; // calendar index of each held day
  closes: Float32Array;
  controls: number[]; // control returns, one per draw
  control0?: { entryDate: string; exitDate: string; returnPct: number; entryFill: number; calIdx: Int32Array; closes: Float32Array };
}

function pathFor(seg: DailySeries, from: number, to: number, calOf: Map<string, number>) {
  const idx: number[] = [];
  const cl: number[] = [];
  for (let i = from; i <= to; i++) {
    const c = calOf.get(seg.dates[i]!);
    if (c === undefined) continue;
    idx.push(c);
    cl.push(seg.close[i]!);
  }
  return { calIdx: Int32Array.from(idx), closes: Float32Array.from(cl) };
}

function closeLookup(calendar: string[], calIdx: Int32Array, closes: Float32Array, calOf: Map<string, number>) {
  return (d: string) => {
    const c = calOf.get(d);
    if (c === undefined) return undefined;
    let lo = 0, hi = calIdx.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (calIdx[mid]! === c) return closes[mid]!;
      if (calIdx[mid]! < c) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  };
}

const fmtT = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");

// ---------------- main ----------------
async function main() {
  loadEnv();
  const dir = dataDir();
  const uniFile = path.join(dir, "universe.json");
  if (!fs.existsSync(uniFile)) {
    console.error(`No universe.json in ${dir}. Run "npm run backtest:download" first.`);
    process.exit(1);
  }
  const universe = JSON.parse(fs.readFileSync(uniFile, "utf8")) as { assets: { symbol: string; status: string }[] };
  const delistedSet = new Set(universe.assets.filter((a) => a.status === "inactive").map((a) => a.symbol));
  const symbols = universe.assets.map((a) => a.symbol).filter((s) => s !== "SPY").slice(0, LIMIT);

  const spy = loadSymbol(dir, "SPY");
  if (!spy?.dates.length) throw new Error("SPY data missing. Re-run the download.");
  const calendar = spy.dates;
  const calOf = new Map(calendar.map((d, i) => [d, i] as const));
  const datasetEnd = calendar[calendar.length - 1]!;
  const index = buildIndexContext(spy);

  const variantNames = Object.keys(BREAKOUT_VARIANTS);
  const cfgs = new Map<string, BreakoutConfig>(variantNames.map((v) => [v, withConfig(BREAKOUT_VARIANTS[v])]));
  const baseCfg = withConfig();
  const recs = new Map<string, Rec[]>(variantNames.map((v) => [v, []]));
  const symIdx = new Map(symbols.map((s, i) => [s, i] as const));
  // eligible[calendarDay][tier] = indices of symbols eligible that day.
  const eligible: number[][][] = calendar.map(() => TIERS.map(() => []));

  console.log(`Universe: ${symbols.length} stocks (${symbols.filter((s) => delistedSet.has(s)).length} delisted), data through ${datasetEnd}`);
  console.log(`Variants: ${variantNames.join(", ")}`);
  console.log(`Random control draws per trade: ${DRAWS}. Portfolio slots: ${SLOTS}.\n`);

  // ---------- Pass 1 ----------
  const t0 = Date.now();
  let loaded = 0;
  for (let k = 0; k < symbols.length; k++) {
    const sym = symbols[k]!;
    const raw = loadSymbol(dir, sym);
    if (raw && raw.dates.length >= 120) {
      const s = clean(raw);
      loaded++;
      for (const seg of splitOnGaps(s, baseCfg.maxGapCalendarDays, datasetEnd, baseCfg.delistGraceDays)) {
        const el = eligibilityByDay(seg, baseCfg);
        for (let i = 0; i < seg.dates.length; i++) {
          const c = calOf.get(seg.dates[i]!);
          const tier = el.tier[i];
          if (c !== undefined && el.eligible[i] && tier) eligible[c]![TIERS.indexOf(tier)]!.push(k);
        }
      }
      const segs = splitOnGaps(s, baseCfg.maxGapCalendarDays, datasetEnd, baseCfg.delistGraceDays);
      for (const v of variantNames) {
        for (const trade of runSymbol(s, cfgs.get(v)!, index, datasetEnd).trades) {
          const seg = segs[trade.segmentIndex]!;
          const e = seg.dates.indexOf(trade.entryDate);
          const x = seg.dates.indexOf(trade.exitDate);
          recs.get(v)!.push({
            trade,
            stopPct: 1 - trade.stop / seg.open[e]!,
            ...pathFor(seg, e, x, calOf),
            controls: [],
          });
        }
      }
    }
    if ((k + 1) % 250 === 0 || k + 1 === symbols.length) {
      const mins = (Date.now() - t0) / 60_000;
      process.stdout.write(`\r  pass 1 (strategy): ${k + 1}/${symbols.length} stocks, ${mins.toFixed(1)} min, ~${((mins / (k + 1)) * (symbols.length - k - 1)).toFixed(0)} min left   `);
    }
  }
  console.log(`\n  ${loaded} stocks had enough data.`);

  // ---------- Pass 2: random-entry controls ----------
  interface Task { v: string; rec: Rec; draw: number }
  const tasks = new Map<number, Task[]>();
  const rnd = seededRandom(20261020);
  let noControl = 0;
  for (const v of variantNames) {
    for (const rec of recs.get(v)!) {
      const c = calOf.get(rec.trade.signalDate);
      const pool = c === undefined ? [] : eligible[c]![TIERS.indexOf(rec.trade.tier)]!;
      const own = symIdx.get(rec.trade.symbol);
      if (pool.length < 2) {
        noControl++;
        continue;
      }
      for (let d = 0; d < DRAWS; d++) {
        let pick = own;
        for (let tries = 0; tries < 10 && pick === own; tries++) pick = pool[Math.floor(rnd() * pool.length)]!;
        if (pick === undefined || pick === own) continue;
        const list = tasks.get(pick);
        const task = { v, rec, draw: d };
        if (list) list.push(task);
        else tasks.set(pick, [task]);
      }
    }
  }
  const t1 = Date.now();
  let doneSyms = 0;
  for (const [k, list] of tasks) {
    const raw = loadSymbol(dir, symbols[k]!);
    if (raw) {
      const s = clean(raw);
      const segs = splitOnGaps(s, baseCfg.maxGapCalendarDays, datasetEnd, baseCfg.delistGraceDays);
      const views = new Map<Segment, WeeklyView>();
      for (const task of list) {
        const sd = task.rec.trade.signalDate;
        const seg = segs.find((g) => g.dates[0]! <= sd && g.dates[g.dates.length - 1]! > sd);
        if (!seg) continue;
        const e = seg.dates.findIndex((d) => d > sd);
        if (e < 0) continue;
        let wv = views.get(seg);
        if (!wv) views.set(seg, (wv = weeklyView(seg, baseCfg.trailingWeeks)));
        const r = simulateFromEntry(seg, wv, e, task.rec.stopPct, task.rec.trade.tier, cfgs.get(task.v)!);
        if (!r) continue;
        task.rec.controls.push(r.returnPct);
        if (task.draw === 0 && !task.rec.control0) {
          task.rec.control0 = {
            entryDate: seg.dates[r.entryIdx]!,
            exitDate: seg.dates[r.exitIdx]!,
            returnPct: r.returnPct,
            entryFill: r.entryFill,
            ...pathFor(seg, r.entryIdx, r.exitIdx, calOf),
          };
        }
      }
    }
    doneSyms++;
    if (doneSyms % 250 === 0 || doneSyms === tasks.size) {
      const mins = (Date.now() - t1) / 60_000;
      process.stdout.write(`\r  pass 2 (random control): ${doneSyms}/${tasks.size} stocks, ${mins.toFixed(1)} min, ~${((mins / doneSyms) * (tasks.size - doneSyms)).toFixed(0)} min left   `);
    }
  }
  console.log("\n");

  // ---------- Results ----------
  const evalCal = calendar.filter((d) => d >= EVAL_START);
  const spyStart = spy.close[calOf.get(evalCal[0]!)!]!;
  const spyEnd = spy.close[calendar.length - 1]!;
  const spyEquity = evalCal.map((d) => spy.close[calOf.get(d)!]! / spyStart);
  const spyResult = {
    totalReturn: spyEnd / spyStart - 1,
    cagr: cagr(1, spyEnd / spyStart, evalCal[0]!, evalCal[evalCal.length - 1]!),
    maxDrawdown: maxDrawdown(spyEquity),
  };

  const toPortfolio = (rs: Rec[], useControl: boolean): PortfolioTrade[] =>
    rs.flatMap((r) => {
      if (useControl) {
        const c = r.control0;
        if (!c || c.entryDate < EVAL_START) return [];
        return [{ symbol: `${r.trade.symbol}~ctl`, entryDate: c.entryDate, exitDate: c.exitDate, returnPct: c.returnPct, entryFill: c.entryFill, closeOn: closeLookup(calendar, c.calIdx, c.closes, calOf), rank: r.trade.volumeRatio }];
      }
      const t = r.trade;
      if (t.entryDate < EVAL_START) return [];
      return [{ symbol: t.symbol, entryDate: t.entryDate, exitDate: t.exitDate, returnPct: t.returnPct, entryFill: t.entryPrice, closeOn: closeLookup(calendar, r.calIdx, r.closes, calOf), rank: t.volumeRatio }];
    });

  const pairsOf = (rs: Rec[]): PairedTrade[] =>
    rs.filter((r) => r.trade.entryDate >= EVAL_START).map((r) => ({ entryDate: r.trade.entryDate, strategyReturn: r.trade.returnPct, controlReturns: r.controls }));

  interface VariantOut { stats: TradeStats; edge: EdgeResult; portfolio: Omit<PortfolioResult, "dates" | "equity">; controlPortfolio: Omit<PortfolioResult, "dates" | "equity"> }
  const out: Record<string, VariantOut> = {};
  const strip = (p: PortfolioResult) => {
    const { dates: _d, equity: _e, ...rest } = p;
    return rest;
  };

  console.log(`=== RESULTS ${EVAL_START} .. ${datasetEnd} (each variant changes ONE rule from default) ===\n`);
  console.log("                           ---------- per trade vs random entry ----------   ------- portfolio, 10 slots -------");
  console.log("variant                   trades  win%  strat avg  random avg   edge    t     strategy CAGR / maxDD   random CAGR / maxDD");
  for (const v of variantNames) {
    const rs = recs.get(v)!;
    const evalRecs = rs.filter((r) => r.trade.entryDate >= EVAL_START);
    const stats = tradeStats(evalRecs.map((r) => r.trade));
    const edge = edgeVsControl(pairsOf(rs));
    const port = simulatePortfolio(evalCal, toPortfolio(rs, false), SLOTS);
    const ctl = simulatePortfolio(evalCal, toPortfolio(rs, true), SLOTS);
    out[v] = { stats, edge, portfolio: strip(port), controlPortfolio: strip(ctl) };
    console.log(
      `${v.padEnd(24)} ${String(stats.closedTrades).padStart(7)}  ${(stats.winRate * 100).toFixed(0).padStart(3)}%  ${pct(edge.strategyMean).padStart(9)}  ${pct(edge.controlMean).padStart(10)}  ${pct(edge.edgePerTrade).padStart(7)}  ${fmtT(edge.clusteredT).padStart(5)}    ${pct(port.cagr).padStart(7)} / ${pct(port.maxDrawdown, 0).padStart(5)}        ${pct(ctl.cagr).padStart(7)} / ${pct(ctl.maxDrawdown, 0).padStart(5)}`,
    );
  }
  console.log(`\nSPY buy-and-hold: CAGR ${pct(spyResult.cagr)}, max drawdown ${pct(spyResult.maxDrawdown, 0)}, total ${pct(spyResult.totalReturn, 0)}`);
  console.log("edge = strategy average minus random-entry average, per trade. t above ~2 = unlikely to be luck (clustered by month).");

  // Default variant detail
  const def = recs.get("default")!.filter((r) => r.trade.entryDate >= EVAL_START);
  const detail = (label: string, key: (r: Rec) => string) => {
    console.log(`\n--- default rules by ${label} ---`);
    const groups = new Map<string, Rec[]>();
    for (const r of def) {
      const k = key(r);
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
    const rows: Record<string, EdgeResult> = {};
    for (const [k, rs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const e = edgeVsControl(rs.map((r) => ({ entryDate: r.trade.entryDate, strategyReturn: r.trade.returnPct, controlReturns: r.controls })));
      rows[k] = e;
      console.log(`  ${k.padEnd(12)} ${String(e.pairedTrades).padStart(6)} trades  strat ${pct(e.strategyMean).padStart(7)}  random ${pct(e.controlMean).padStart(7)}  edge ${pct(e.edgePerTrade).padStart(7)}  t ${fmtT(e.clusteredT)}`);
    }
    return rows;
  };
  const bySetup = detail("setup", (r) => r.trade.setup);
  const byTier = detail("liquidity tier", (r) => r.trade.tier);
  const byRs = detail("relative-strength tag", (r) => (r.trade.selloffStrength === null ? "index-ok" : r.trade.selloffStrength ? "led" : "lagged"));
  const byYear = detail("entry year", (r) => r.trade.entryDate.slice(0, 4));

  const defStats = statsBy(def.map((r) => r.trade), (t) => t.exitReason);
  const sorted = [...def].sort((a, b) => b.trade.returnPct - a.trade.returnPct);
  console.log("\n--- default rules: exits ---");
  for (const [k, st] of Object.entries(defStats)) console.log(`  ${k.padEnd(9)} ${st.trades} trades, avg ${pct(st.avgReturn)}`);
  console.log(`  ${noControl} trades had no eligible control stock that day (excluded from the edge).`);
  console.log("\n--- 10 best and 5 worst default trades (check these for bad data) ---");
  for (const r of [...sorted.slice(0, 10), ...sorted.slice(-5)]) {
    const t = r.trade;
    console.log(`  ${t.symbol.padEnd(6)} ${t.setup} ${t.entryDate} -> ${t.exitDate} ${t.exitReason.padEnd(8)} ${pct(t.returnPct).padStart(9)}  entry ${t.entryPrice.toFixed(2)}`);
  }

  const report = {
    ranAt: new Date().toISOString(),
    evalStart: EVAL_START,
    datasetEnd,
    universe: { symbols: symbols.length, loaded, delisted: symbols.filter((s) => delistedSet.has(s)).length },
    settings: { draws: DRAWS, slots: SLOTS, defaultConfig: baseCfg, variants: BREAKOUT_VARIANTS },
    spy: spyResult,
    variants: out,
    defaultDetail: { bySetup, byTier, byRs, byYear, byExit: defStats },
    defaultTrades: def.map((r) => {
      const t = r.trade;
      return [t.symbol, t.setup, t.signalDate, t.entryDate, t.exitDate, t.exitReason, +t.returnPct.toFixed(4), t.tier, t.selloffStrength, +t.volumeRatio.toFixed(2), r.controls.map((c) => +c.toFixed(4))];
    }),
    defaultTradeColumns: ["symbol", "setup", "signalDate", "entryDate", "exitDate", "exitReason", "returnPct", "tier", "rsTag", "volumeRatio", "controlReturns"],
  };
  const file = path.join(resultsDir(), `universe-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(report));
  console.log(`\nSaved ${file}\nSend that file to Claude.`);
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
