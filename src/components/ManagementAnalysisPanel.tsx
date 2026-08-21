"use client";

import { useState } from "react";
import type {
  CredibilityRating,
  ManagementAnalysisResult,
  ManagementRating,
} from "@/lib/management-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: ManagementAnalysisResult };

const RATING_STYLE: Record<ManagementRating, { label: string; color: string; bg: string }> = {
  strong: { label: "STRONG", color: "text-up", bg: "bg-up/10" },
  good: { label: "GOOD", color: "text-up", bg: "bg-up/10" },
  neutral: { label: "NEUTRAL", color: "text-gray-300", bg: "bg-gray-500/10" },
  concerning: { label: "CONCERNING", color: "text-down", bg: "bg-down/10" },
  very_concerning: { label: "VERY CONCERNING", color: "text-down", bg: "bg-down/10" },
};

const CREDIBILITY_LABEL: Record<CredibilityRating, string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  insufficient_data: "INSUFFICIENT DATA",
};

const TREND_ARROW: Record<string, string> = {
  increasing: "↑",
  decreasing: "↓",
  flat: "→",
  unavailable: "—",
};

/**
 * On-demand (button-triggered) since it calls a paid AI API. Leads with
 * "Is Management Doing a Good Job?" + score, then what's going well /
 * concerns, then track record, capital allocation, insider activity, and
 * credibility — matching the spec's UI order.
 */
export function ManagementAnalysisPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/management/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Management analysis failed." });
        return;
      }
      setState({ status: "success", data: body as ManagementAnalysisResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Is Management Doing a Good Job?
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
          Looks at how management uses the company&apos;s money (dividends, debt, cash) and real insider
          buying/selling to judge execution and trustworthiness — honestly noting where data (like
          historical guidance) isn&apos;t available rather than guessing.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: ManagementAnalysisResult }) {
  const { interpretation, capitalAllocation, insiderActivity, recentInsiderTransactionCount } = result;
  const ratingStyle = RATING_STYLE[interpretation.overallAssessment];

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`rounded-lg px-4 py-2 ${ratingStyle.bg}`}>
          <div className={`text-sm font-bold tracking-wide ${ratingStyle.color}`}>{ratingStyle.label}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Management Score</div>
          <div className={`text-2xl font-semibold tabular-nums ${ratingStyle.color}`}>
            {interpretation.managementScore > 0 ? "+" : ""}
            {interpretation.managementScore}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
          <span className="text-[11px] text-gray-500">confidence: {(interpretation.confidenceScore * 100).toFixed(0)}%</span>
        </div>
        <p className="mt-2 text-sm text-gray-300">{interpretation.overallConclusion}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="What Management Is Doing Well" items={interpretation.whatManagementIsDoingWell} color="text-up" />
        <FactorList title="Management Concerns" items={interpretation.managementConcerns} color="text-down" />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-gray-200">Track Record vs. Previous Guidance</h3>
        <p className="text-xs text-gray-400">{interpretation.trackRecordVsGuidance}</p>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Capital Allocation — How Management Uses the Money</h3>
        <p className="mb-2 text-xs text-gray-400">{interpretation.capitalAllocationAssessment}</p>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <TrendCell label="Dividends" trend={capitalAllocation.dividendsPaidTrend} />
          <TrendCell label="Debt" trend={capitalAllocation.totalDebtTrend} inverse />
          <TrendCell label="Cash" trend={capitalAllocation.cashTrend} />
          <TrendCell label="Free Cash Flow" trend={capitalAllocation.freeCashFlowTrend} />
          <TrendCell label="Shares (buybacks)" trend={capitalAllocation.impliedSharesOutstandingTrend} inverse />
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">
          Insider Activity {recentInsiderTransactionCount > 0 && `(${recentInsiderTransactionCount} recent transactions)`}
        </h3>
        <p className="text-xs text-gray-400">{interpretation.insiderActivityAssessment}</p>
        {insiderActivity.transactionCount > 0 && (
          <p className="mt-1 text-[11px] text-gray-500">
            {insiderActivity.purchaseCount} purchase{insiderActivity.purchaseCount === 1 ? "" : "s"} ·{" "}
            {insiderActivity.saleCount} sale{insiderActivity.saleCount === 1 ? "" : "s"}
            {insiderActivity.mostRecentTransactionDate && (
              <> · most recent: {new Date(insiderActivity.mostRecentTransactionDate).toLocaleDateString()}</>
            )}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-bg/40 p-3">
        <h3 className="text-xs font-semibold text-gray-200">
          Can We Trust Management&apos;s Forecasts?{" "}
          <span className="ml-1 text-accent">{CREDIBILITY_LABEL[interpretation.managementCredibility]}</span>
        </h3>
        <p className="mt-1 text-xs text-gray-400">{interpretation.managementCredibilityExplanation}</p>
      </div>
    </div>
  );
}

function FactorList({
  title,
  items,
  color,
}: {
  title: string;
  items: { factor: string; explanation: string }[];
  color: string;
}) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">None identified.</p>
      ) : (
        <ul className="space-y-1.5 text-xs text-gray-300">
          {items.map((f, i) => (
            <li key={i}>
              <span className="font-medium text-gray-200">{f.factor}: </span>
              {f.explanation}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendCell({
  label,
  trend,
  inverse,
}: {
  label: string;
  trend: { direction: string; changePct: number | null };
  inverse?: boolean;
}) {
  const goodDirection = inverse ? "decreasing" : "increasing";
  const color =
    trend.direction === "unavailable"
      ? "text-gray-600"
      : trend.direction === goodDirection
        ? "text-up"
        : trend.direction === "flat"
          ? "text-gray-300"
          : "text-down";

  return (
    <div className="rounded-md border border-border bg-panel/60 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`font-semibold ${color}`}>
        {TREND_ARROW[trend.direction]}
        {trend.changePct !== null && ` ${Math.abs(trend.changePct).toFixed(0)}%`}
      </div>
    </div>
  );
}
