import { describe, expect, it } from "vitest";
import type { PriceBar } from "@/lib/types";
import { evaluateTrendReset } from "@/lib/trend-reset";
import { scanHistories, sortScanRows } from "./trend-reset-scan";

function series(segments: [number, number, number][], start = Date.UTC(2025, 0, 1)): PriceBar[] {
  const bars: PriceBar[] = [];
  for (const [count, from, to] of segments) {
    for (let i = 0; i < count; i++) {
      const close = from + ((to - from) * i) / Math.max(1, count - 1);
      const d = new Date(start + bars.length * 86_400_000).toISOString();
      bars.push({ timestamp: d, open: close, high: close, low: close, close, volume: 1_000 });
    }
  }
  return bars;
}

// Same shape the watchlist tests use: climb, run-up, flat stretch.
const qualifying = () => series([[150, 100, 150], [30, 150, 190], [81, 190, 190.5]]);
const downtrend = () => series([[261, 200, 100]]);
// 100 days ending on the same date as the 261-day fixtures.
const short = () => series([[100, 100, 110]], Date.UTC(2025, 0, 1) + 161 * 86_400_000);

describe("scanHistories", () => {
  it("keeps qualifying stocks, using the same evaluation as the watchlist", () => {
    const bars = qualifying();
    expect(evaluateTrendReset(bars).qualifies).toBe(true); // guard: the fixture really qualifies
    const r = scanHistories(["good", "BAD"], new Map([["GOOD", bars], ["BAD", downtrend()]]));
    expect(r.evaluated).toBe(2);
    expect(r.rows.map((x) => x.ticker)).toEqual(["GOOD"]);
    expect(r.rows[0]!.qualifies).toBe(true);
    expect(r.rows[0]!.conditionsMet).toBe(4);
  });

  it("reports missing, short and stale histories as skipped, not as failures of the rules", () => {
    const fresh = qualifying();
    // Same length, but ending 30 days before the others: stopped trading.
    const stale = series([[150, 100, 150], [30, 150, 190], [81, 190, 190.5]], Date.UTC(2024, 11, 2));
    const r = scanHistories(
      ["A", "B", "C", "D"],
      new Map([["A", fresh], ["B", short()], ["D", stale]]),
    );
    expect(r.skipped.map((s) => s.ticker).sort()).toEqual(["B", "C", "D"]);
    expect(r.skipped.find((s) => s.ticker === "C")!.reason).toMatch(/no price data/);
    expect(r.skipped.find((s) => s.ticker === "B")!.reason).toMatch(/not enough history/);
    expect(r.skipped.find((s) => s.ticker === "D")!.reason).toMatch(/no recent prices/);
  });

  it("sorts qualifying first, then the most complete reset", () => {
    const base = { price: 1, sma200: 1, pctAboveSma: 1, maxRoc63PriorPct: 20, asOfDate: "2026-10-20", conditions: [] };
    const rows = sortScanRows([
      { ...base, ticker: "C3", qualifies: false, conditionsMet: 3, roc63Pct: 0 },
      { ...base, ticker: "Q2", qualifies: true, conditionsMet: 4, roc63Pct: -2.5 },
      { ...base, ticker: "Q1", qualifies: true, conditionsMet: 4, roc63Pct: 0.4 },
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["Q1", "Q2", "C3"]);
  });
});
