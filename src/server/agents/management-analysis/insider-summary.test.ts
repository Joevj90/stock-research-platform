import { describe, expect, it } from "vitest";
import { summarizeInsiderActivity } from "./insider-summary";
import type { InsiderTransaction } from "@/lib/insider-trading-types";

function tx(overrides: Partial<InsiderTransaction> = {}): InsiderTransaction {
  return {
    ticker: "AAPL",
    reportingName: "Someone",
    role: "officer",
    transactionType: "sale",
    transactionDate: "2026-08-01T00:00:00.000Z",
    filingDate: "2026-08-03T00:00:00.000Z",
    shares: 1000,
    pricePerShare: 200,
    url: null,
    provider: "fmp",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("summarizeInsiderActivity", () => {
  it("counts purchases and sales separately", () => {
    const result = summarizeInsiderActivity([
      tx({ transactionType: "purchase", shares: 500 }),
      tx({ transactionType: "sale", shares: 300 }),
      tx({ transactionType: "sale", shares: 200 }),
    ]);
    expect(result.purchaseCount).toBe(1);
    expect(result.saleCount).toBe(2);
    expect(result.transactionCount).toBe(3);
  });

  it("computes net shares purchased (purchases minus sales)", () => {
    const result = summarizeInsiderActivity([
      tx({ transactionType: "purchase", shares: 1000 }),
      tx({ transactionType: "sale", shares: 400 }),
    ]);
    expect(result.netSharesPurchased).toBe(600);
  });

  it("finds the most recent transaction date", () => {
    const result = summarizeInsiderActivity([
      tx({ transactionDate: "2026-01-01T00:00:00.000Z" }),
      tx({ transactionDate: "2026-08-01T00:00:00.000Z" }),
      tx({ transactionDate: "2026-03-01T00:00:00.000Z" }),
    ]);
    expect(result.mostRecentTransactionDate).toBe("2026-08-01T00:00:00.000Z");
  });

  it("handles an empty transaction list without crashing", () => {
    const result = summarizeInsiderActivity([]);
    expect(result.transactionCount).toBe(0);
    expect(result.netSharesPurchased).toBe(0);
    expect(result.mostRecentTransactionDate).toBeNull();
  });
});
