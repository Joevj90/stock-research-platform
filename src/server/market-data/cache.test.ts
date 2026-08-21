import { describe, expect, it } from "vitest";
import { isFresh, periodToRange, QUOTE_CACHE_TTL_MS, HISTORICAL_CACHE_TTL_MS } from "./cache";

describe("isFresh", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("is fresh when retrieved well within the TTL", () => {
    const retrievedAt = new Date("2026-08-20T11:59:30.000Z"); // 30s ago
    expect(isFresh(retrievedAt, QUOTE_CACHE_TTL_MS, now)).toBe(true);
  });

  it("is stale once the TTL has fully elapsed", () => {
    const retrievedAt = new Date("2026-08-20T11:58:00.000Z"); // 2min ago
    expect(isFresh(retrievedAt, QUOTE_CACHE_TTL_MS, now)).toBe(false);
  });

  it("treats the exact TTL boundary as stale (strict less-than)", () => {
    const retrievedAt = new Date(now.getTime() - QUOTE_CACHE_TTL_MS);
    expect(isFresh(retrievedAt, QUOTE_CACHE_TTL_MS, now)).toBe(false);
  });

  it("treats a future retrievedAt as fresh (clock skew doesn't crash it)", () => {
    const retrievedAt = new Date(now.getTime() + 1000);
    expect(isFresh(retrievedAt, QUOTE_CACHE_TTL_MS, now)).toBe(true);
  });

  it("historical TTL is much longer than quote TTL", () => {
    expect(HISTORICAL_CACHE_TTL_MS).toBeGreaterThan(QUOTE_CACHE_TTL_MS);
    const retrievedAt = new Date("2026-08-20T06:00:00.000Z"); // 6h ago
    expect(isFresh(retrievedAt, HISTORICAL_CACHE_TTL_MS, now)).toBe(true);
    expect(isFresh(retrievedAt, QUOTE_CACHE_TTL_MS, now)).toBe(false);
  });
});

describe("periodToRange", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");

  it("computes a ~1 month range for 1M", () => {
    const { from, to } = periodToRange("1M", now);
    expect(to).toEqual(now);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(31, 0);
  });

  it("computes a ~5 year range for 5Y", () => {
    const { from, to } = periodToRange("5Y", now);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(5 * 366, 0);
  });

  it("orders every supported period from shortest to longest range", () => {
    const periods = ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;
    const spans = periods.map((p) => {
      const { from, to } = periodToRange(p, now);
      return to.getTime() - from.getTime();
    });
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]).toBeGreaterThan(spans[i - 1]!);
    }
  });
});
