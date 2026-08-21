import type { FinancialPeriod, ValidationWarning } from "@/lib/fundamentals-types";

/**
 * Deterministic sanity checks on a single reported financial period.
 * These never throw and never discard data -- an inconsistent or unusual
 * figure is still real data that a filing reported (or that a provider
 * mis-mapped), so it's flagged for visibility rather than dropped. Pure
 * function, no I/O, so it's trivial to unit test every rule in isolation.
 */
export function validateFinancialPeriod(period: FinancialPeriod): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Accounting equation: assets = liabilities + equity (allow a small
  // tolerance for rounding/minor classification differences across
  // providers -- anything beyond that suggests a data quality issue).
  if (period.totalAssets !== null && period.totalLiabilities !== null && period.shareholdersEquity !== null) {
    const expected = period.totalLiabilities + period.shareholdersEquity;
    const diff = Math.abs(period.totalAssets - expected);
    const tolerance = Math.max(Math.abs(period.totalAssets) * 0.02, 1_000_000); // 2% or $1M
    if (diff > tolerance) {
      warnings.push({
        code: "BALANCE_SHEET_MISMATCH",
        message:
          "Total assets does not approximately equal total liabilities plus shareholders' equity for this period.",
      });
    }
  }

  // Gross profit can't exceed revenue.
  if (period.grossProfit !== null && period.revenue !== null && period.grossProfit > period.revenue) {
    warnings.push({
      code: "GROSS_PROFIT_EXCEEDS_REVENUE",
      message: "Gross profit is reported as greater than revenue, which shouldn't be possible.",
    });
  }

  // Operating income can't (sensibly) exceed gross profit.
  if (
    period.operatingIncome !== null &&
    period.grossProfit !== null &&
    period.operatingIncome > period.grossProfit
  ) {
    warnings.push({
      code: "OPERATING_INCOME_EXCEEDS_GROSS_PROFIT",
      message: "Operating income is reported as greater than gross profit, which is unusual.",
    });
  }

  // Free cash flow should roughly equal operating cash flow minus capex.
  // FMP reports capitalExpenditures as a negative number (a cash outflow);
  // normalize the sign before comparing.
  if (
    period.freeCashFlow !== null &&
    period.operatingCashFlow !== null &&
    period.capitalExpenditures !== null
  ) {
    const expectedFcf = period.operatingCashFlow - Math.abs(period.capitalExpenditures);
    const diff = Math.abs(period.freeCashFlow - expectedFcf);
    const tolerance = Math.max(Math.abs(period.operatingCashFlow) * 0.02, 1_000_000);
    if (diff > tolerance) {
      warnings.push({
        code: "FREE_CASH_FLOW_MISMATCH",
        message: "Free cash flow doesn't approximately equal operating cash flow minus capital expenditures.",
      });
    }
  }

  // A revenue figure that's negative is essentially always a data error.
  if (period.revenue !== null && period.revenue < 0) {
    warnings.push({
      code: "NEGATIVE_REVENUE",
      message: "Revenue is reported as negative, which is almost always a data error.",
    });
  }

  // Reporting period end date sanity: not in the future, not implausibly old.
  const periodEnd = new Date(period.reportingPeriodEnd);
  const now = new Date();
  if (!isNaN(periodEnd.getTime())) {
    if (periodEnd.getTime() > now.getTime()) {
      warnings.push({
        code: "FUTURE_PERIOD_END",
        message: "This period's reporting date is in the future.",
      });
    }
    const fiftyYearsAgo = new Date(now);
    fiftyYearsAgo.setFullYear(fiftyYearsAgo.getFullYear() - 50);
    if (periodEnd.getTime() < fiftyYearsAgo.getTime()) {
      warnings.push({
        code: "IMPLAUSIBLY_OLD_PERIOD",
        message: "This period's reporting date is implausibly far in the past.",
      });
    }
  } else {
    warnings.push({
      code: "INVALID_PERIOD_END_DATE",
      message: "This period's reporting date could not be parsed.",
    });
  }

  // Quarterly/annual consistency: an annual period shouldn't carry a
  // fiscal quarter number, and vice versa.
  if (period.periodType === "annual" && period.fiscalQuarter !== null) {
    warnings.push({
      code: "ANNUAL_PERIOD_HAS_QUARTER",
      message: "This period is marked annual but has a fiscal quarter set.",
    });
  }
  if (period.periodType === "quarterly" && period.fiscalQuarter === null) {
    warnings.push({
      code: "QUARTERLY_PERIOD_MISSING_QUARTER",
      message: "This period is marked quarterly but has no fiscal quarter set.",
    });
  }

  return warnings;
}
