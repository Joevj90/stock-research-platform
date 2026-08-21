import type { ExplainedMetricSeries, FinancialPeriodType } from "@/lib/fundamentals-types";

/**
 * Rule-based (NOT AI-generated) plain-English explanations of a metric's
 * trend across periods. This deliberately stays simple template logic --
 * compare first vs. last, check direction, describe magnitude -- because
 * this step is the reliable data layer, not the Fundamental Analyst agent.
 * A future AI agent can build richer narrative on top of this; this layer
 * only needs to turn "the numbers went from X to Y" into a sentence a
 * non-investor can understand, with backend precision preserved separately
 * in `values` (the explanation is the only thing simplified).
 */

interface MetricConfig {
  label: string;
  /** Everyday description of what this line item represents, used when
   * there isn't enough history to describe a trend. */
  whatItMeans: string;
  /** True for metrics where "more" is generally better (revenue, profit,
   * cash) vs. ambiguous (debt, where more isn't automatically bad). */
  moreIsGood: boolean | "ambiguous";
  isCurrency: boolean;
}

const METRIC_CONFIG: Record<string, MetricConfig> = {
  revenue: {
    label: "Revenue",
    whatItMeans: "the total money the company brought in from selling its products or services.",
    moreIsGood: true,
    isCurrency: true,
  },
  grossProfit: {
    label: "Gross Profit",
    whatItMeans: "what's left of revenue after subtracting the direct cost of making the product or service.",
    moreIsGood: true,
    isCurrency: true,
  },
  operatingIncome: {
    label: "Operating Income",
    whatItMeans: "the profit from the company's normal, everyday business, before interest and taxes.",
    moreIsGood: true,
    isCurrency: true,
  },
  netIncome: {
    label: "Net Income",
    whatItMeans: "the company's total profit after all expenses, interest, and taxes -- the 'bottom line'.",
    moreIsGood: true,
    isCurrency: true,
  },
  eps: {
    label: "Earnings Per Share",
    whatItMeans: "how much profit the company made for each share of stock investors own.",
    moreIsGood: true,
    isCurrency: false,
  },
  cash: {
    label: "Cash",
    whatItMeans: "money the company has on hand right now.",
    moreIsGood: true,
    isCurrency: true,
  },
  totalDebt: {
    label: "Debt",
    whatItMeans: "money the company owes and has to pay back, usually with interest.",
    moreIsGood: "ambiguous",
    isCurrency: true,
  },
  freeCashFlow: {
    label: "Free Cash Flow",
    whatItMeans:
      "the cash a company generates after paying for the costs required to run and maintain the business.",
    moreIsGood: true,
    isCurrency: true,
  },
};

/**
 * Builds an ExplainedMetricSeries for one line item across a set of
 * periods. `values` must already be oldest-first and aligned with the
 * periods the caller is describing.
 */
export function explainMetricSeries(
  metricKey: keyof typeof METRIC_CONFIG,
  values: (number | null)[],
  periodType: FinancialPeriodType
): ExplainedMetricSeries {
  const config = METRIC_CONFIG[metricKey]!;
  const formattedValues = values.map((v) => (v === null ? "—" : formatValue(v, config.isCurrency)));

  const nonNullValues = values.filter((v): v is number => v !== null);
  if (nonNullValues.length < 2) {
    return {
      label: config.label,
      values,
      formattedValues,
      explanation:
        nonNullValues.length === 1
          ? `${config.label} is ${config.whatItMeans} Not enough history yet to describe a trend.`
          : `${config.label} is ${config.whatItMeans} No data available for this company yet.`,
    };
  }

  const first = nonNullValues[0]!;
  const last = nonNullValues[nonNullValues.length - 1]!;
  const cadence = periodType === "annual" ? "year" : "quarter";
  const explanation = buildTrendSentence(config, first, last, nonNullValues, cadence);

  return { label: config.label, values, formattedValues, explanation };
}

function buildTrendSentence(
  config: MetricConfig,
  first: number,
  last: number,
  series: number[],
  cadence: string
): string {
  const percentChange = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
  const isMonotonicUp = series.every((v, i) => i === 0 || v >= series[i - 1]!);
  const isMonotonicDown = series.every((v, i) => i === 0 || v <= series[i - 1]!);
  const direction = last > first ? "up" : last < first ? "down" : "flat";

  const changeDescriptor =
    percentChange === null
      ? ""
      : ` (${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(0)}% over this period)`;

  if (direction === "flat") {
    return `${config.label} has stayed roughly the same across recent ${cadence}s${changeDescriptor}.`;
  }

  const trendWord = direction === "up" ? "grown" : "shrunk";
  const steadiness = direction === "up" && isMonotonicUp
    ? "steadily "
    : direction === "down" && isMonotonicDown
      ? "steadily "
      : "";

  let base: string;
  if (config.moreIsGood === true) {
    const sentiment = direction === "up" ? "a good sign" : "worth keeping an eye on";
    base = `${config.label} has ${steadiness}${trendWord} over recent ${cadence}s${changeDescriptor}. Since ${describeGoodBad(
      config,
      direction
    )}, this is generally ${sentiment}.`;
  } else if (config.moreIsGood === "ambiguous") {
    const note =
      direction === "up"
        ? "This isn't automatically bad, but the company now has more financial obligations."
        : "The company has been paying down what it owes.";
    base = `${config.label} has ${steadiness}${trendWord} over recent ${cadence}s${changeDescriptor}. ${note}`;
  } else {
    base = `${config.label} has ${steadiness}${trendWord} over recent ${cadence}s${changeDescriptor}.`;
  }

  return base;
}

function describeGoodBad(config: MetricConfig, direction: "up" | "down"): string {
  if (direction === "up") return `more ${config.label.toLowerCase()} generally means the business is doing better`;
  return `less ${config.label.toLowerCase()} can be a warning sign`;
}

function formatValue(value: number, isCurrency: boolean): string {
  if (!isCurrency) {
    return value.toFixed(2);
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}
