import { describe, expect, it } from "vitest";
import { withConfig } from "./config";
import { runSymbol } from "./engine";
import { tradeStats } from "./metrics";
import { type DailySeries, priorAverage, sma, splitOnGaps, truncate, weekKey, weeklyView } from "./series";
import { computeSignals } from "./signals";

// ---------- helpers ----------

/** Consecutive weekdays starting Monday 2020-01-06. */
function weekdays(n: number, start = "2020-01-06"): string[] {
  const out: string[] = [];
  let ms = Date.parse(`${start}T00:00:00Z`);
  while (out.length < n) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86_400_000;
  }
  return out;
}

interface B {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
const bar = (c: number, v: number, spread = 0.5): B => ({ o: c, h: c + spread, l: c - spread, c, v });

function series(bars: B[], symbol = "TEST", dates = weekdays(bars.length)): DailySeries {
  return {
    symbol,
    dates,
    open: bars.map((b) => b.o),
    high: bars.map((b) => b.h),
    low: bars.map((b) => b.l),
    close: bars.map((b) => b.c),
    volume: bars.map((b) => b.v),
  };
}

/**
 * A textbook Setup A: 100 days far above (ends the base), a 60-day base
 * between 90 and 100 on 800k volume, a 15-day tight stretch 97.5-99.5 on
 * 300k (volume dry-up), then a breakout close at 103 on `breakoutVol`.
 * Returns the bars and the breakout index.
 */
function baseThenBreakout(opts: { breakoutVol?: number; tightLow?: number } = {}): { bars: B[]; b: number } {
  const bars: B[] = [];
  for (let i = 0; i < 100; i++) bars.push(bar(130, 1_000_000));
  for (let i = 0; i < 60; i++) bars.push(bar(i % 2 ? 91 : 99, 800_000));
  const tl = opts.tightLow ?? 98;
  for (let i = 0; i < 15; i++) bars.push(bar(i % 2 ? tl : 99, 300_000));
  const b = bars.length;
  bars.push({ o: 100, h: 103.5, l: 99.5, c: 103, v: opts.breakoutVol ?? 2_000_000 });
  return { bars, b };
}

const cfg = withConfig();

// ---------- series utilities ----------

describe("series utilities", () => {
  it("sma and priorAverage", () => {
    expect(sma([1, 2, 3, 4], 2).slice(1)).toEqual([1.5, 2.5, 3.5]);
    expect(Number.isNaN(sma([1, 2, 3], 2)[0]!)).toBe(true);
    // priorAverage excludes the current value
    expect(priorAverage([1, 2, 3, 100], 3)[3]).toBe(2);
    expect(Number.isNaN(priorAverage([1, 2, 3], 3)[2]!)).toBe(true);
  });

  it("weekKey returns the Monday", () => {
    expect(weekKey("2024-03-08")).toBe("2024-03-04"); // Friday
    expect(weekKey("2024-03-04")).toBe("2024-03-04"); // Monday
    expect(weekKey("2024-03-10")).toBe("2024-03-04"); // Sunday
  });

  it("weeklyView marks week ends but never the final bar", () => {
    const s = series(Array.from({ length: 12 }, (_, i) => bar(10 + i, 1)));
    const wv = weeklyView(s, 2);
    // days 0-4 = week 1, 5-9 = week 2, 10-11 = week 3 (incomplete)
    expect(wv.isWeekEnd.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([4, 9]);
    expect(wv.weeklySma[9]).toBe((14 + 19) / 2);
    expect(wv.isWeekEnd[11]).toBe(false);
  });

  it("splitOnGaps splits at long gaps and flags abrupt endings", () => {
    const d1 = weekdays(5, "2023-01-02");
    const d2 = weekdays(5, "2025-06-02");
    const s = series(
      Array.from({ length: 10 }, () => bar(10, 1)),
      "BBBY",
      [...d1, ...d2],
    );
    const segs = splitOnGaps(s, 30, d2[4]!, 14);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.endsAbruptly).toBe(true); // stopped trading, ticker later reused
    expect(segs[1]!.endsAbruptly).toBe(false); // runs to the dataset end
    expect(splitOnGaps(s, 30, "2026-10-19", 14)[1]!.endsAbruptly).toBe(true);
  });
});

// ---------- Setup A ----------

describe("Setup A: tight base breakout", () => {
  it("fires on a tight, quiet base broken on heavy volume", () => {
    const { bars, b } = baseThenBreakout();
    const sigs = computeSignals(series(bars), cfg, null);
    const a = sigs[b]!.find((x) => x.setup === "A");
    expect(a).toBeDefined();
    expect(a!.pivot).toBeCloseTo(99.5);
    expect(a!.baseDays).toBe(75);
    expect(a!.stop).toBeCloseTo(97.5); // lowest low of the breakout week
    expect(sigs.flat().filter((x) => x.setup === "A")).toHaveLength(1);
  });

  it("does not fire when breakout volume is too light", () => {
    const { bars, b } = baseThenBreakout({ breakoutVol: 350_000 });
    expect(computeSignals(series(bars), cfg, null)[b]!.some((x) => x.setup === "A")).toBe(false);
  });

  it("does not fire when the final stretch is not tight", () => {
    const { bars, b } = baseThenBreakout({ tightLow: 85 });
    expect(computeSignals(series(bars), cfg, null)[b]!.some((x) => x.setup === "A")).toBe(false);
  });

  it("respects a dated governance exclusion", () => {
    const { bars, b } = baseThenBreakout();
    const s = series(bars);
    const excluded = withConfig({ governanceExclusions: [{ symbol: "TEST", from: s.dates[0]!, reason: "test" }] });
    const later = withConfig({ governanceExclusions: [{ symbol: "TEST", from: "2099-01-01", reason: "test" }] });
    expect(computeSignals(s, excluded, null)[b]!).toHaveLength(0);
    expect(computeSignals(s, later, null)[b]!.length).toBeGreaterThan(0);
  });
});

// ---------- Setup B ----------

describe("Setup B: first pullback after a breakout", () => {
  function pullbackBars(turnVol: number) {
    const { bars, b } = baseThenBreakout();
    for (const c of [104, 105.5, 107, 108]) bars.push(bar(c, 900_000)); // follow-through
    for (const c of [104, 102, 101, 100.5]) bars.push(bar(c, 200_000)); // quiet pullback to the pivot
    bars.push({ o: 100.8, h: 103.2, l: 100.6, c: 103, v: turnVol }); // turn up
    return { bars, b, turn: bars.length - 1 };
  }

  it("fires on a quiet pullback to the breakout level that turns up on volume", () => {
    const { bars, turn } = pullbackBars(600_000);
    const sig = computeSignals(series(bars), cfg, null)[turn]!.find((x) => x.setup === "B");
    expect(sig).toBeDefined();
    expect(sig!.stop).toBeCloseTo(100); // pullback low
  });

  it("does not fire when the turn-up day has no volume", () => {
    const { bars, turn } = pullbackBars(150_000);
    expect(computeSignals(series(bars), cfg, null)[turn]!.some((x) => x.setup === "B")).toBe(false);
  });
});

// ---------- engine ----------

describe("engine", () => {
  it("enters at the next open and exits a gap-down at the open, not the stop", () => {
    const { bars } = baseThenBreakout();
    bars.push({ o: 104, h: 105, l: 103, c: 104.5, v: 900_000 }); // entry day
    bars.push({ o: 80, h: 81, l: 79, c: 80, v: 3_000_000 }); // gap through the stop
    bars.push(bar(80, 1_000_000));
    const s = series(bars);
    const r = runSymbol(s, cfg, null, s.dates[s.dates.length - 1]!);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.setup).toBe("A");
    expect(t.exitReason).toBe("stop");
    const slip = cfg.slippageBps[t.tier] / 1e4;
    expect(t.entryPrice).toBeCloseTo(104 * (1 + slip));
    expect(t.exitPrice).toBeCloseTo(80 * (1 - slip)); // filled at the open, below the 97.5 stop
    expect(t.returnPct).toBeLessThan(80 / 104 - 1);
  });

  it("exits on a weekly close below the 10-week average, at the next open", () => {
    const { bars } = baseThenBreakout();
    let p = 103;
    for (let i = 0; i < 60; i++) bars.push(bar((p += 0.8), 900_000)); // run up to ~151
    for (let i = 0; i < 40; i++) bars.push(bar((p -= 0.6), 900_000)); // slow fade, stays far above the stop
    const s = series(bars);
    const r = runSymbol(s, cfg, null, s.dates[s.dates.length - 1]!);
    const t = r.trades[0]!;
    expect(t.exitReason).toBe("trailing");
    expect(t.returnPct).toBeGreaterThan(0.2);
    const exitIdx = s.dates.indexOf(t.exitDate);
    // Signal day was the previous bar and was a Friday (last trading day of its week).
    expect(new Date(`${s.dates[exitIdx - 1]}T00:00:00Z`).getUTCDay()).toBe(5);
  });

  it("marks a position open when the stock stops trading as a total loss by default", () => {
    const { bars } = baseThenBreakout();
    for (let i = 0; i < 10; i++) bars.push(bar(105 + i, 900_000));
    const s = series(bars);
    const r = runSymbol(s, cfg, null, "2026-10-19");
    expect(r.trades[0]!.exitReason).toBe("delisted");
    expect(r.trades[0]!.returnPct).toBe(-1);
    const lenient = runSymbol(s, withConfig({ delistMode: "lastClose" }), null, "2026-10-19");
    expect(lenient.trades[0]!.returnPct).toBeGreaterThan(0);
  });

  it("marks a position open at the dataset end as 'open', excluded from closed stats", () => {
    const { bars } = baseThenBreakout();
    for (let i = 0; i < 10; i++) bars.push(bar(105, 900_000));
    const s = series(bars);
    const r = runSymbol(s, cfg, null, s.dates[s.dates.length - 1]!);
    expect(r.trades[0]!.exitReason).toBe("open");
    const st = tradeStats(r.trades);
    expect(st.openTrades).toBe(1);
    expect(st.closedTrades).toBe(0);
  });

  it("confirm5 cancels the entry when a close falls back below the pivot", () => {
    const { bars } = baseThenBreakout();
    bars.push(bar(101, 900_000));
    bars.push(bar(98.5, 900_000)); // closes back below the 99.5 pivot
    for (let i = 0; i < 10; i++) bars.push(bar(99, 300_000));
    const s = series(bars);
    const r = runSymbol(s, withConfig({ entryMode: "confirm5" }), null, s.dates[s.dates.length - 1]!);
    expect(r.cancelledConfirmations).toBe(1);
    expect(r.trades.filter((t) => t.setup === "A")).toHaveLength(0);
  });

  it("does not carry a position across a ticker-reuse gap", () => {
    const { bars } = baseThenBreakout();
    for (let i = 0; i < 5; i++) bars.push(bar(105, 900_000));
    const firstDates = weekdays(bars.length, "2020-01-06");
    const reused = Array.from({ length: 30 }, () => bar(20, 500_000));
    const s = series([...bars, ...reused], "REUSE", [...firstDates, ...weekdays(30, "2025-06-02")]);
    const r = runSymbol(s, cfg, null, weekdays(30, "2025-06-02")[29]!);
    expect(r.segments).toBe(2);
    expect(r.trades[0]!.exitReason).toBe("delisted");
    expect(r.trades[0]!.exitDate < "2025-01-01").toBe(true);
  });
});

// ---------- lookahead ----------

describe("no lookahead", () => {
  /** Deterministic random walk with occasional volume spikes and gaps so
   * every setup gets a chance to fire. */
  function randomSeries(n: number, seed: number): DailySeries {
    let x = seed;
    const rnd = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const bars: B[] = [];
    let p = 20;
    for (let i = 0; i < n; i++) {
      const spike = rnd() < 0.03;
      const gap = spike ? 1 + 0.05 + rnd() * 0.1 : 1 + (rnd() - 0.5) * 0.01;
      const o = p * gap;
      const c = o * (1 + (rnd() - 0.45) * (spike ? 0.06 : 0.03));
      const h = Math.max(o, c) * (1 + rnd() * 0.01);
      const l = Math.min(o, c) * (1 - rnd() * 0.01);
      bars.push({ o, h, l, c, v: (spike ? 8 : 1) * (500_000 + rnd() * 500_000) });
      p = c;
    }
    return series(bars, `R${seed}`);
  }

  it("signals computed on a truncated history match the full-history signals", () => {
    let total = 0;
    for (const seed of [1, 7, 42]) {
      const full = randomSeries(700, seed);
      const fullSigs = computeSignals(full, cfg, null);
      total += fullSigs.flat().length;
      for (const k of [150, 333, 512, 699]) {
        const part = computeSignals(truncate(full, k), cfg, null);
        expect(part).toEqual(fullSigs.slice(0, k));
      }
    }
    expect(total).toBeGreaterThan(0); // the test is vacuous if nothing ever fires
  });

  it("trades closed before a cut are identical with or without later data", () => {
    const full = randomSeries(700, 99);
    const end = full.dates[699]!;
    const fullTrades = runSymbol(full, withConfig({ catalystEntry: "immediate" }), null, end).trades;
    const cut = 500;
    const part = runSymbol(truncate(full, cut), withConfig({ catalystEntry: "immediate" }), null, end).trades;
    // The cut copy looks delisted, so only compare trades that closed
    // before the cut's last week.
    const lastSafe = full.dates[cut - 6]!;
    const closedBefore = (ts: typeof fullTrades) => ts.filter((t) => t.exitDate <= lastSafe);
    expect(closedBefore(part)).toEqual(closedBefore(fullTrades));
    expect(fullTrades.length).toBeGreaterThan(0);
  });
});
