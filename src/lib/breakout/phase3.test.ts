import { describe, expect, it } from "vitest";
import { edgeVsControl, seededRandom } from "./compare";
import { withConfig } from "./config";
import { capStop, runSymbol, simulateFromEntry } from "./engine";
import { maxDrawdown, simulatePortfolio, type PortfolioTrade } from "./portfolio";
import { type DailySeries, splitOnGaps, weeklyView } from "./series";
import { buildIndexContext, rsLeadershipTags } from "./signals";

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

function fromCloses(symbol: string, closes: number[], vol = 1_000_000): DailySeries {
  return {
    symbol,
    dates: weekdays(closes.length),
    open: [...closes],
    high: closes.map((c) => c * 1.005),
    low: closes.map((c) => c * 0.995),
    close: [...closes],
    volume: closes.map(() => vol),
  };
}

function randomSeries(n: number, seed: number): DailySeries {
  const rnd = seededRandom(seed);
  const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let p = 20;
  for (let i = 0; i < n; i++) {
    const spike = rnd() < 0.03;
    const oo = p * (spike ? 1.05 + rnd() * 0.1 : 1 + (rnd() - 0.5) * 0.01);
    const cc = oo * (1 + (rnd() - 0.45) * (spike ? 0.06 : 0.03));
    o.push(oo);
    c.push(cc);
    h.push(Math.max(oo, cc) * (1 + rnd() * 0.01));
    l.push(Math.min(oo, cc) * (1 - rnd() * 0.01));
    v.push((spike ? 8 : 1) * (500_000 + rnd() * 500_000));
    p = cc;
  }
  return { symbol: `R${seed}`, dates: weekdays(n), open: o, high: h, low: l, close: c, volume: v };
}

describe("approved rule: 20% stop cap", () => {
  it("raises a stop that sits more than 20% below the entry open", () => {
    const cfg = withConfig();
    expect(capStop(3.07, 9.27, cfg)).toBeCloseTo(9.27 * 0.8); // the ASTS case
    expect(capStop(97.5, 104, cfg)).toBe(97.5); // a normal stop is untouched
  });

  it("applies the cap inside the engine", () => {
    const closes = Array.from({ length: 100 }, () => 10);
    const s = fromCloses("CAT", closes);
    // Catalyst day: gap up, huge range, closes near the high, 5x volume.
    s.dates.push(...weekdays(103).slice(100));
    s.open.push(10.5, 13, 12);
    s.high.push(13, 13.2, 12.2);
    s.low.push(5, 12.5, 10);
    s.close.push(12.8, 13, 10.2);
    s.volume.push(5_000_000, 2_000_000, 2_000_000);
    const r = runSymbol(s, withConfig({ catalystEntry: "immediate", setupA: false }), null, s.dates[102]!);
    const t = r.trades[0]!;
    expect(t.setup).toBe("C");
    expect(t.stop).toBeCloseTo(13 * 0.8); // not the catalyst-day low of 5
    expect(t.exitReason).toBe("stop");
  });
});

describe("approved rule: relative-strength leadership tag", () => {
  // SPY: drifts 100 -> 110 over 100 days, then falls ~10% over 20 days.
  const spyCloses = [
    ...Array.from({ length: 100 }, (_, i) => 100 + i * 0.1),
    ...Array.from({ length: 20 }, (_, i) => 110 - (i + 1) * 0.55),
    ...Array.from({ length: 30 }, () => 99),
  ];
  const spy = fromCloses("SPY", spyCloses);
  const index = buildIndexContext(spy);
  const cfg = withConfig();

  it("is null while SPY is not weak", () => {
    const tags = rsLeadershipTags(fromCloses("X", spyCloses.map((c) => c / 2)), index, cfg);
    expect(tags[80]).toBeNull();
  });

  it("is true for a stock rising while SPY falls", () => {
    const leader = fromCloses("LEAD", spyCloses.map((_, i) => (i < 100 ? 50 : 50 + (i - 99) * 0.2)));
    expect(rsLeadershipTags(leader, index, cfg)[115]).toBe(true);
  });

  it("is false for a stock falling harder than SPY", () => {
    const laggard = fromCloses("LAG", spyCloses.map((c, i) => (i < 100 ? c / 2 : (c / 2) * (1 - (i - 99) * 0.01))));
    expect(rsLeadershipTags(laggard, index, cfg)[115]).toBe(false);
  });

  it("is null without index data", () => {
    expect(rsLeadershipTags(spy, null, cfg).every((x) => x === null)).toBe(true);
  });
});

describe("random-entry control uses the same exits as the engine", () => {
  it("simulateFromEntry reproduces every engine exit", () => {
    let checked = 0;
    for (const seed of [3, 11, 29]) {
      const s = randomSeries(800, seed);
      const cfg = withConfig({ catalystEntry: "immediate" });
      const end = s.dates[s.dates.length - 1]!;
      const seg = splitOnGaps(s, cfg.maxGapCalendarDays, end, cfg.delistGraceDays)[0]!;
      const wv = weeklyView(seg, cfg.trailingWeeks);
      for (const t of runSymbol(s, cfg, null, end).trades) {
        const e = seg.dates.indexOf(t.entryDate);
        const r = simulateFromEntry(seg, wv, e, 1 - t.stop / seg.open[e]!, t.tier, cfg)!;
        expect(seg.dates[r.exitIdx]).toBe(t.exitDate);
        expect(r.exitReason).toBe(t.exitReason);
        expect(r.returnPct).toBeCloseTo(t.returnPct, 8);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe("portfolio simulation", () => {
  const cal = weekdays(6);
  const trade = (symbol: string, e: number, x: number, ret: number, rank: number, closes: number[]): PortfolioTrade => ({
    symbol,
    entryDate: cal[e]!,
    exitDate: cal[x]!,
    returnPct: ret,
    entryFill: 100,
    closeOn: (d: string) => new Map(closes.map((c, k) => [cal[e + k]!, c])).get(d),
    rank,
  });

  it("fills slots by rank, marks to market, and settles exits", () => {
    const a = trade("AAA", 1, 4, 0.1, 5, [100, 120, 90, 110]);
    const b = trade("BBB", 1, 3, 0.5, 1, [100, 150, 150]);
    const r = simulatePortfolio(cal, [a, b], 1);
    expect(r.tradesTaken).toBe(1); // only one slot; AAA has the higher rank
    expect(r.tradesSkipped).toBe(1);
    expect(r.equity[2]).toBeCloseTo(1.2); // 1 slot = 100% of equity, AAA at 120
    expect(r.equity[3]).toBeCloseTo(0.9);
    expect(r.equity[5]).toBeCloseTo(1.1); // exited at +10%
    expect(r.maxDrawdown).toBeCloseTo(0.9 / 1.2 - 1);
  });

  it("splits equity across slots", () => {
    const a = trade("AAA", 0, 2, 1.0, 1, [100, 200]);
    const b = trade("BBB", 0, 2, 0.0, 1, [100, 100]);
    const r = simulatePortfolio(cal, [a, b], 4);
    expect(r.equity[5]).toBeCloseTo(1 + 0.25 * 1.0);
    expect(r.avgExposure).toBeLessThan(0.5);
  });

  it("maxDrawdown", () => {
    expect(maxDrawdown([1, 2, 1, 3, 1.5])).toBeCloseTo(-0.5);
  });
});

describe("edge vs control", () => {
  it("reports the per-trade edge and a month-clustered t", () => {
    const pairs = [
      { entryDate: "2020-01-05", strategyReturn: 0.1, controlReturns: [0.0, 0.02] },
      { entryDate: "2020-01-20", strategyReturn: 0.05, controlReturns: [0.01] },
      { entryDate: "2020-02-03", strategyReturn: 0.0, controlReturns: [0.02] },
      { entryDate: "2020-03-03", strategyReturn: 0.2, controlReturns: [0.0] },
      { entryDate: "2020-04-03", strategyReturn: 0.1, controlReturns: [] }, // no control: excluded
    ];
    const r = edgeVsControl(pairs);
    expect(r.pairedTrades).toBe(4);
    expect(r.months).toBe(3);
    expect(r.strategyMean).toBeCloseTo(0.0875);
    expect(r.edgePerTrade).toBeCloseTo(0.0875 - 0.01);
    expect(r.monthsAhead).toBeCloseTo(2 / 3);
    expect(Number.isFinite(r.clusteredT)).toBe(true);
  });

  it("seededRandom is reproducible", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
