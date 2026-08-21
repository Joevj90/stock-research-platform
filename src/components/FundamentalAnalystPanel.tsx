"use client";

import { useState } from "react";
import type { FinancialPeriodType } from "@/lib/fundamentals-types";
import type { Assessment, FundamentalAnalystResult } from "@/lib/fundamental-analyst-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: FundamentalAnalystResult };

const ASSESSMENT_SECTIONS: { key: keyof FundamentalAnalystResult["interpretation"]; label: string }[] = [
  { key: "revenueAssessment", label: "Revenue" },
  { key: "earningsAssessment", label: "Earnings" },
  { key: "profitabilityAssessment", label: "Profitability" },
  { key: "cashFlowAssessment", label: "Cash Flow" },
  { key: "balanceSheetAssessment", label: "Balance Sheet" },
  { key: "growthAssessment", label: "Growth" },
  { key: "financialStrengthAssessment", label: "Financial Strength" },
];

/**
 * On-demand (button-triggered, not automatic) since it calls a paid AI
 * API and needs Step 5's financial data underneath it. Leads with the
 * AI's plain-language conclusions; the raw calculated numbers (growth
 * rates, ROE, ROIC, etc.) are available but tucked behind a toggle so a
 * non-expert isn't confronted with a wall of ratios up front.
 */
export function FundamentalAnalystPanel({
  ticker,
  periodType,
}: {
  ticker: string;
  periodType: FinancialPeriodType;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [showDetails, setShowDetails] = useState(false);

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/fundamental-analysis/${ticker}?period=${periodType}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Analysis failed." });
        return;
      }
      setState({ status: "success", data: body as FundamentalAnalystResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Fundamental Analyst
        </h2>
        <button
          onClick={runAnalysis}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Analyzing…" : "Run Analysis"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Looks at real revenue, profit, cash flow, and debt data from company filings to judge how
          financially healthy the company appears — explained in plain language, with the underlying
          numbers available if you want to check them.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && (
        <ResultView result={state.data} showDetails={showDetails} setShowDetails={setShowDetails} />
      )}
    </section>
  );
}

function ResultView({
  result,
  showDetails,
  setShowDetails,
}: {
  result: FundamentalAnalystResult;
  showDetails: boolean;
  setShowDetails: (v: boolean) => void;
}) {
  const { calculated, interpretation } = result;
  const score = interpretation.overallFundamentalScore;
  const scoreColor = score >= 20 ? "text-up" : score <= -20 ? "text-down" : "text-gray-300";

  return (
    <div className="mt-4 flex flex-col gap-5">
      {/* Lead with the conclusion — most important thing first. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
              AI Interpretation
            </span>
            <span className="text-[11px] text-gray-500">
              model: {interpretation.model} · confidence:{" "}
              {(interpretation.confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-200">{interpretation.overallConclusion}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Fundamental Score</div>
          <div className={`text-2xl font-semibold tabular-nums ${scoreColor}`}>
            {score > 0 ? "+" : ""}
            {score}
          </div>
        </div>
      </div>

      {(interpretation.positiveFactors.length > 0 || interpretation.negativeFactors.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FactorList title="Positive factors" items={interpretation.positiveFactors} color="text-up" />
          <FactorList title="Negative factors" items={interpretation.negativeFactors} color="text-down" />
        </div>
      )}

      {interpretation.keyConcerns.length > 0 && (
        <FactorList title="Key concerns" items={interpretation.keyConcerns} color="text-yellow-400" />
      )}
      {interpretation.importantTrends.length > 0 && (
        <FactorList title="Important trends" items={interpretation.importantTrends} color="text-gray-300" />
      )}

      {/* Detailed assessments — secondary to the conclusion above. */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {ASSESSMENT_SECTIONS.map(({ key, label }) => (
          <AssessmentCard key={key} label={label} assessment={interpretation[key] as Assessment} />
        ))}
      </div>

      {/* Supporting calculated numbers — tucked behind a toggle. */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {showDetails ? "Hide" : "Show"} supporting financial details
        </button>
        {showDetails && <CalculatedDetails calculated={calculated} />}
      </div>
    </div>
  );
}

function AssessmentCard({ label, assessment }: { label: string; assessment: Assessment }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <h3 className="text-xs font-semibold text-gray-200">{label}</h3>
      <dl className="mt-1.5 flex flex-col gap-1 text-xs text-gray-400">
        <div>
          <dt className="inline font-medium text-gray-300">What happened: </dt>
          <dd className="inline">{assessment.whatHappened}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Why it matters: </dt>
          <dd className="inline">{assessment.whyItMatters}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Good or bad: </dt>
          <dd className="inline">{assessment.isGoodOrBad}</dd>
        </div>
      </dl>
    </div>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      <ul className="space-y-1 text-xs text-gray-300">
        {items.map((s, i) => (
          <li key={i}>• {s}</li>
        ))}
      </ul>
    </div>
  );
}

function CalculatedDetails({ calculated }: { calculated: FundamentalAnalystResult["calculated"] }) {
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
          Calculation
        </span>
        <span className="text-[11px] text-gray-500">
          {calculated.periodsAnalyzed} periods · fiscal years {calculated.fiscalYears.join(", ")}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-3 py-1">Metric</th>
              {calculated.fiscalYears.map((y) => (
                <th key={y} className="px-2 py-1 text-right tabular-nums">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <MetricRow label="Revenue growth" values={calculated.revenueGrowthPct} suffix="%" />
            <MetricRow label="Earnings growth" values={calculated.earningsGrowthPct} suffix="%" />
            <MetricRow label="EPS growth" values={calculated.epsGrowthPct} suffix="%" />
            <MetricRow label="Free cash flow growth" values={calculated.freeCashFlowGrowthPct} suffix="%" />
            <MetricRow label="Gross margin" values={calculated.grossMarginPct} suffix="%" />
            <MetricRow label="Operating margin" values={calculated.operatingMarginPct} suffix="%" />
            <MetricRow label="Net margin" values={calculated.netMarginPct} suffix="%" />
            <MetricRow label="Return on equity" values={calculated.returnOnEquityPct} suffix="%" />
            <MetricRow label="Return on invested capital" values={calculated.returnOnInvestedCapitalPct} suffix="%" />
            <MetricRow label="Asset turnover" values={calculated.assetTurnover} suffix="x" />
            <MetricRow label="Debt to equity" values={calculated.debtToEquity} suffix="x" />
            <MetricRow label="Debt to operating cash flow" values={calculated.debtToOperatingCashFlow} suffix="x" />
            <MetricRow label="Earnings quality ratio" values={calculated.earningsQualityRatio} suffix="x" />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Every number above is computed directly from reported financial data — never estimated or
        generated by AI. "Data unavailable" in the analysis above means the underlying figure was null
        here.
      </p>
    </div>
  );
}

function MetricRow({ label, values, suffix }: { label: string; values: (number | null)[]; suffix: string }) {
  return (
    <tr className="border-t border-border/50">
      <td className="pr-3 py-1 text-gray-400">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1 text-right tabular-nums">
          {v === null ? "—" : `${v.toFixed(1)}${suffix}`}
        </td>
      ))}
    </tr>
  );
}
