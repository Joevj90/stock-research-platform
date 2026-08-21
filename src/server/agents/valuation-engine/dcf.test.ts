import { describe, expect, it } from "vitest";
import {
  computeFairValuePerShare,
  deriveSharesOutstanding,
  buildSensitivity,
  buildScenarioAssumptions,
  runDcfScenario,
} from "./dcf";
import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { DcfAssumptions } from "@/lib/valuation-types";

function period(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear: 2025,
    fiscalQuarter: null,
    reportingPeriodEnd: "2025-09-30T00:00:00.000Z",
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: 100_000_000_000,
    grossProfit: 40_000_000_000,
    operatingIncome: 25_000_000_000,
    netIncome: 20_000_000_000,
    eps: 2,
    cash: 10_000_000_000,
    totalAssets: 200_000_000_000,
    totalLiabilities: 100_000_000_000,
    totalDebt: 30_000_000_000,
    shareholdersEquity: 100_000_000_000,
    operatingCashFlow: 22_000_000_000,
    capitalExpenditures: -5_000_000_000,
    freeCashFlow: 17_000_000_000,
    ebitda: 30_000_000_000,
    dividendsPaid: -3_000_000_000,
    ...overrides,
  };
}

const BASE_ASSUMPTIONS: DcfAssumptions = {
  initialRevenueGrowthPct: 10,
  terminalRevenueGrowthPct: 3,
  operatingMarginPct: 25,
  taxRatePct: 21,
  capexAsPctOfRevenue: 5,
  workingCapitalChangeAsPctOfRevenue: 1,
  discountRatePct: 9,
  terminalGrowthRatePct: 2.5,
  projectionYears: 5,
};

describe("deriveSharesOutstanding", () => {
  it("derives shares from net income / eps, both real figures", () => {
    const shares = deriveSharesOutstanding(period({ netIncome: 20_000_000_000, eps: 2 }));
    expect(shares).toBeCloseTo(10_000_000_000, 0);
  });

  it("returns null when eps is zero or missing", () => {
    expect(deriveSharesOutstanding(period({ eps: 0 }))).toBeNull();
    expect(deriveSharesOutstanding(period({ eps: null }))).toBeNull();
  });

  it("returns null for a negative implied share count", () => {
    expect(deriveSharesOutstanding(period({ netIncome: -1000, eps: 2 }))).toBeNull();
  });
});

describe("computeFairValuePerShare", () => {
  const shares = 10_000_000_000;

  it("produces a positive fair value under reasonable assumptions", () => {
    const value = computeFairValuePerShare(period(), shares, BASE_ASSUMPTIONS);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(0);
  });

  it("returns null when the discount rate does not exceed the terminal growth rate (Gordon Growth requires r > g)", () => {
    const invalid = { ...BASE_ASSUMPTIONS, discountRatePct: 2, terminalGrowthRatePct: 3 };
    expect(computeFairValuePerShare(period(), shares, invalid)).toBeNull();
  });

  it("returns null when revenue is missing or non-positive", () => {
    expect(computeFairValuePerShare(period({ revenue: null }), shares, BASE_ASSUMPTIONS)).toBeNull();
    expect(computeFairValuePerShare(period({ revenue: 0 }), shares, BASE_ASSUMPTIONS)).toBeNull();
  });

  it("returns null when shares outstanding is null or non-positive", () => {
    expect(computeFairValuePerShare(period(), null, BASE_ASSUMPTIONS)).toBeNull();
    expect(computeFairValuePerShare(period(), 0, BASE_ASSUMPTIONS)).toBeNull();
  });

  it("produces a higher fair value with a lower discount rate, all else equal (sanity check on the math direction)", () => {
    const highDiscount = computeFairValuePerShare(period(), shares, { ...BASE_ASSUMPTIONS, discountRatePct: 12 });
    const lowDiscount = computeFairValuePerShare(period(), shares, { ...BASE_ASSUMPTIONS, discountRatePct: 6 });
    expect(lowDiscount!).toBeGreaterThan(highDiscount!);
  });

  it("produces a higher fair value with higher revenue growth, all else equal", () => {
    const lowGrowth = computeFairValuePerShare(period(), shares, {
      ...BASE_ASSUMPTIONS,
      initialRevenueGrowthPct: 2,
      terminalRevenueGrowthPct: 2,
    });
    const highGrowth = computeFairValuePerShare(period(), shares, {
      ...BASE_ASSUMPTIONS,
      initialRevenueGrowthPct: 20,
      terminalRevenueGrowthPct: 20,
    });
    expect(highGrowth!).toBeGreaterThan(lowGrowth!);
  });

  it("accounts for net debt by reducing equity value relative to zero debt", () => {
    const withDebt = computeFairValuePerShare(period({ totalDebt: 50_000_000_000, cash: 0 }), shares, BASE_ASSUMPTIONS);
    const noDebt = computeFairValuePerShare(period({ totalDebt: 0, cash: 0 }), shares, BASE_ASSUMPTIONS);
    expect(noDebt!).toBeGreaterThan(withDebt!);
  });
});

describe("runDcfScenario", () => {
  it("computes implied upside/downside relative to the current price", () => {
    const scenario = runDcfScenario(period(), 10_000_000_000, BASE_ASSUMPTIONS, "base", 100);
    expect(scenario.name).toBe("base");
    expect(scenario.fairValuePerShare).not.toBeNull();
    if (scenario.fairValuePerShare !== null) {
      const expectedUpside = ((scenario.fairValuePerShare - 100) / 100) * 100;
      expect(scenario.impliedUpsideDownsidePct).toBeCloseTo(expectedUpside, 5);
    }
  });

  it("carries the exact assumptions object used, for transparency", () => {
    const scenario = runDcfScenario(period(), 10_000_000_000, BASE_ASSUMPTIONS, "bull", 100);
    expect(scenario.assumptions).toEqual(BASE_ASSUMPTIONS);
  });
});

describe("buildSensitivity", () => {
  it("returns all four required sensitivity dimensions", () => {
    const rows = buildSensitivity(period(), 10_000_000_000, BASE_ASSUMPTIONS);
    const parameters = rows.map((r) => r.parameter);
    expect(parameters).toEqual(["revenueGrowth", "operatingMargin", "discountRate", "terminalGrowth"]);
  });

  it("shows fair value increasing monotonically as revenue growth delta increases", () => {
    const rows = buildSensitivity(period(), 10_000_000_000, BASE_ASSUMPTIONS);
    const revenueRow = rows.find((r) => r.parameter === "revenueGrowth")!;
    const values = revenueRow.results.map((r) => r.fairValuePerShare!);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it("shows fair value decreasing as discount rate delta increases", () => {
    const rows = buildSensitivity(period(), 10_000_000_000, BASE_ASSUMPTIONS);
    const discountRow = rows.find((r) => r.parameter === "discountRate")!;
    const values = discountRow.results.map((r) => r.fairValuePerShare!);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]!);
    }
  });
});

describe("buildScenarioAssumptions", () => {
  it("anchors the base case on real observed growth and margin, not arbitrary numbers", () => {
    const { base } = buildScenarioAssumptions(period(), 15);
    expect(base.initialRevenueGrowthPct).toBe(15);
    expect(base.operatingMarginPct).toBeCloseTo(25, 5); // 25B operating income / 100B revenue
  });

  it("makes the bear case strictly more conservative than base, and bull strictly more optimistic", () => {
    const { bear, base, bull } = buildScenarioAssumptions(period(), 15);
    expect(bear.initialRevenueGrowthPct).toBeLessThan(base.initialRevenueGrowthPct);
    expect(bull.initialRevenueGrowthPct).toBeGreaterThan(base.initialRevenueGrowthPct);
    expect(bear.discountRatePct).toBeGreaterThan(base.discountRatePct);
    expect(bull.discountRatePct).toBeLessThan(base.discountRatePct);
  });

  it("falls back to a reasonable default when no real growth figure is available, rather than crashing", () => {
    const { base } = buildScenarioAssumptions(period(), null);
    expect(base.initialRevenueGrowthPct).toBe(5);
  });

  it("produces bear <= base <= bull fair values for the same company (assumptions are directionally consistent)", () => {
    const { bear, base, bull } = buildScenarioAssumptions(period(), 15);
    const shares = deriveSharesOutstanding(period())!;
    const bearValue = computeFairValuePerShare(period(), shares, bear)!;
    const baseValue = computeFairValuePerShare(period(), shares, base)!;
    const bullValue = computeFairValuePerShare(period(), shares, bull)!;
    expect(bearValue).toBeLessThanOrEqual(baseValue);
    expect(baseValue).toBeLessThanOrEqual(bullValue);
  });
});
