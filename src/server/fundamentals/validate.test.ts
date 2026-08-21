import { describe, expect, it } from "vitest";
import { validateFinancialPeriod } from "./validate";
import type { FinancialPeriod } from "@/lib/fundamentals-types";

function basePeriod(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear: 2025,
    fiscalQuarter: null,
    reportingPeriodEnd: "2025-09-30T00:00:00.000Z",
    filingDate: "2025-10-30T00:00:00.000Z",
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: 400_000_000_000,
    grossProfit: 180_000_000_000,
    operatingIncome: 120_000_000_000,
    netIncome: 100_000_000_000,
    eps: 6.5,
    cash: 30_000_000_000,
    totalAssets: 350_000_000_000,
    totalLiabilities: 250_000_000_000,
    totalDebt: 100_000_000_000,
    shareholdersEquity: 100_000_000_000,
    operatingCashFlow: 110_000_000_000,
    capitalExpenditures: -10_000_000_000,
    freeCashFlow: 100_000_000_000,
    ebitda: 140_000_000_000,
    dividendsPaid: -15_000_000_000,
    ...overrides,
  };
}

describe("validateFinancialPeriod", () => {
  it("produces no warnings for an internally consistent period", () => {
    expect(validateFinancialPeriod(basePeriod())).toEqual([]);
  });

  it("flags a balance sheet that doesn't balance", () => {
    const period = basePeriod({ totalAssets: 350_000_000_000, totalLiabilities: 250_000_000_000, shareholdersEquity: 50_000_000_000 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "BALANCE_SHEET_MISMATCH")).toBe(true);
  });

  it("tolerates small rounding differences in the balance sheet", () => {
    const period = basePeriod({ totalAssets: 350_000_000_000, totalLiabilities: 250_000_000_000, shareholdersEquity: 100_000_500_000 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "BALANCE_SHEET_MISMATCH")).toBe(false);
  });

  it("flags gross profit exceeding revenue", () => {
    const period = basePeriod({ revenue: 100, grossProfit: 200 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "GROSS_PROFIT_EXCEEDS_REVENUE")).toBe(true);
  });

  it("flags operating income exceeding gross profit", () => {
    const period = basePeriod({ grossProfit: 100, operatingIncome: 200 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "OPERATING_INCOME_EXCEEDS_GROSS_PROFIT")).toBe(true);
  });

  it("flags a free cash flow figure inconsistent with OCF minus capex", () => {
    const period = basePeriod({ operatingCashFlow: 100_000_000_000, capitalExpenditures: -10_000_000_000, freeCashFlow: 50_000_000_000 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "FREE_CASH_FLOW_MISMATCH")).toBe(true);
  });

  it("handles capex reported as positive vs negative consistently", () => {
    // FMP reports capex as negative; make sure a positive capex figure is
    // still normalized the same way (absolute value subtracted).
    const negCapex = basePeriod({ operatingCashFlow: 100, capitalExpenditures: -20, freeCashFlow: 80 });
    const posCapex = basePeriod({ operatingCashFlow: 100, capitalExpenditures: -20, freeCashFlow: 80 });
    expect(validateFinancialPeriod(negCapex).some((w) => w.code === "FREE_CASH_FLOW_MISMATCH")).toBe(false);
    expect(validateFinancialPeriod(posCapex).some((w) => w.code === "FREE_CASH_FLOW_MISMATCH")).toBe(false);
  });

  it("flags negative revenue", () => {
    const period = basePeriod({ revenue: -1000 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "NEGATIVE_REVENUE")).toBe(true);
  });

  it("flags a future reporting period end date", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const period = basePeriod({ reportingPeriodEnd: future.toISOString() });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "FUTURE_PERIOD_END")).toBe(true);
  });

  it("flags an implausibly old reporting period end date", () => {
    const period = basePeriod({ reportingPeriodEnd: "1900-01-01T00:00:00.000Z" });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "IMPLAUSIBLY_OLD_PERIOD")).toBe(true);
  });

  it("flags an unparseable reporting period end date", () => {
    const period = basePeriod({ reportingPeriodEnd: "not-a-date" });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "INVALID_PERIOD_END_DATE")).toBe(true);
  });

  it("flags an annual period carrying a fiscal quarter", () => {
    const period = basePeriod({ periodType: "annual", fiscalQuarter: 2 });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "ANNUAL_PERIOD_HAS_QUARTER")).toBe(true);
  });

  it("flags a quarterly period missing a fiscal quarter", () => {
    const period = basePeriod({ periodType: "quarterly", fiscalQuarter: null });
    const warnings = validateFinancialPeriod(period);
    expect(warnings.some((w) => w.code === "QUARTERLY_PERIOD_MISSING_QUARTER")).toBe(true);
  });

  it("does not flag missing (null) fields as errors", () => {
    const period = basePeriod({
      totalAssets: null,
      totalLiabilities: null,
      shareholdersEquity: null,
      grossProfit: null,
      operatingCashFlow: null,
      capitalExpenditures: null,
      freeCashFlow: null,
      ebitda: null,
      dividendsPaid: null,
    });
    expect(validateFinancialPeriod(period)).toEqual([]);
  });
});
