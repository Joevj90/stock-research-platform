/**
 * Normalized fundamental-financial-data types. Kept in their own file
 * (rather than added to src/lib/types.ts) specifically so nothing from
 * Steps 1-4's shared types has to change to add this step.
 */

export type FinancialPeriodType = "annual" | "quarterly";

/**
 * One reporting period's worth of financial-statement data, normalized to
 * a single consistent shape regardless of which provider supplied it —
 * this is what makes different companies (and, later, different
 * providers) comparable. Every field is precise (no rounding for
 * display) — simplification only happens in the separate explanation
 * layer, never here.
 *
 * Metadata fields (source, filingDate, reportingPeriodEnd, fiscalYear,
 * fiscalQuarter, retrievedAt) are mandatory on every period so no
 * financial data point in this app is ever unattributed.
 */
export interface FinancialPeriod {
  // --- Metadata: every data point's provenance ---
  source: string; // e.g. "fmp"
  ticker: string;
  periodType: FinancialPeriodType;
  fiscalYear: number;
  fiscalQuarter: number | null; // null for annual periods
  reportingPeriodEnd: string; // ISO date — the period the statement covers
  filingDate: string | null; // ISO date — when the filing was submitted, if known
  retrievedAt: string; // ISO datetime — when this app fetched it
  reportedCurrency: string | null;

  // --- Income statement ---
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;

  // --- Balance sheet ---
  cash: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalDebt: number | null;
  shareholdersEquity: number | null;

  // --- Cash flow statement ---
  operatingCashFlow: number | null;
  capitalExpenditures: number | null;
  freeCashFlow: number | null;
}

/** A single deterministic validation finding about a FinancialPeriod —
 * never blocks the data from being stored/shown, just flags it. */
export interface ValidationWarning {
  code: string;
  message: string;
}

/** A FinancialPeriod plus whatever validation checks found, kept
 * alongside rather than merged into the period itself so "the numbers"
 * and "what we noticed about the numbers" stay visibly separate. */
export interface ValidatedFinancialPeriod {
  period: FinancialPeriod;
  warnings: ValidationWarning[];
}

/** Deterministically computed comparability ratios for one period — plain
 * arithmetic on the stored figures, not AI-derived. Any ratio that can't
 * be computed (missing inputs, division by zero) is null rather than a
 * fabricated number. */
export interface FinancialRatios {
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  debtToEquity: number | null;
}

/** One period's numbers + a plain-English, rule-based explanation of what
 * changed vs. the prior period — the explanation is template-generated
 * from the numbers, never LLM-generated (that's the Fundamental Analyst
 * agent's job, not this layer's). */
export interface ExplainedMetricSeries {
  label: string;
  values: (number | null)[]; // oldest first, aligned with `periods`
  formattedValues: string[]; // e.g. "$100.0B" — display-precision only
  explanation: string;
}

export interface FundamentalsResult {
  ticker: string;
  periodType: FinancialPeriodType;
  periods: ValidatedFinancialPeriod[]; // oldest first
  ratios: FinancialRatios[]; // aligned with `periods`
  metricSeries: {
    revenue: ExplainedMetricSeries;
    grossProfit: ExplainedMetricSeries;
    operatingIncome: ExplainedMetricSeries;
    netIncome: ExplainedMetricSeries;
    eps: ExplainedMetricSeries;
    cash: ExplainedMetricSeries;
    totalDebt: ExplainedMetricSeries;
    freeCashFlow: ExplainedMetricSeries;
  };
}
