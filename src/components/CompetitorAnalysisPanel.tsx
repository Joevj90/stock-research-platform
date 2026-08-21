"use client";

import { useState } from "react";
import type { ComparisonLevel, CompetitorAnalysisResult } from "@/lib/competitor-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: CompetitorAnalysisResult };

const LEVEL_STYLE: Record<ComparisonLevel, { label: string; color: string }> = {
  leading: { label: "Leading", color: "text-up" },
  average: { label: "Average", color: "text-gray-300" },
  lagging: { label: "Lagging", color: "text-down" },
  unavailable: { label: "—", color: "text-gray-600" },
};

const COLUMNS: { key: keyof CompetitorAnalysisResult["interpretation"]["comparisonTable"][number]; label: string }[] = [
  { key: "growth", label: "Growth" },
  { key: "profitability", label: "Profitability" },
  { key: "financialStrength", label: "Financial Strength" },
  { key: "valuation", label: "Valuation" },
  { key: "competitivePosition", label: "Competitive Position" },
];

/**
 * On-demand (button-triggered) since it calls a paid AI API and fetches
 * data for several competitors. Leads with "Who Is Winning?", then the
 * comparison table, score, strengths/weaknesses, and the biggest threat
 * — matching the spec's simple, non-overwhelming presentation.
 */
export function CompetitorAnalysisPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/competitors/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Competitor analysis failed." });
        return;
      }
      setState({ status: "success", data: body as CompetitorAnalysisResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          How Does This Company Compare?
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
          Identifies the company&apos;s real competitors and compares growth, profitability, financial
          strength, and valuation using real numbers — not just companies from the same broad industry.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: CompetitorAnalysisResult }) {
  const { interpretation, competitors } = result;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
              AI Interpretation
            </span>
            <span className="text-[11px] text-gray-500">confidence: {(interpretation.confidenceScore * 100).toFixed(0)}%</span>
          </div>
          <h3 className="mt-2 text-xs font-semibold text-gray-200">Who Is Winning?</h3>
          <p className="mt-1 text-sm text-gray-300">{interpretation.whoIsWinning}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Competitive Score</div>
          <div
            className={`text-2xl font-semibold tabular-nums ${
              interpretation.competitiveScore >= 20
                ? "text-up"
                : interpretation.competitiveScore <= -20
                  ? "text-down"
                  : "text-gray-300"
            }`}
          >
            {interpretation.competitiveScore > 0 ? "+" : ""}
            {interpretation.competitiveScore}
          </div>
        </div>
      </div>

      {competitors.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Major Competitors</h3>
          <ul className="space-y-1.5 text-xs text-gray-300">
            {interpretation.competitorSelections.map((c) => (
              <li key={c.ticker}>
                <span className="font-medium text-gray-100">{c.companyName ?? c.ticker}</span>{" "}
                <span className="text-gray-500">({c.ticker})</span> — {c.whyRelevant}
              </li>
            ))}
          </ul>
        </div>
      )}

      {interpretation.comparisonTable.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-3 py-1.5">Company</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 text-center">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {interpretation.comparisonTable.map((row) => (
                <tr key={row.ticker} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 font-medium text-gray-200">
                    {row.companyName ?? row.ticker} <span className="text-gray-500">({row.ticker})</span>
                  </td>
                  {COLUMNS.map((c) => {
                    const level = row[c.key] as ComparisonLevel;
                    return (
                      <td key={c.key} className={`px-2 py-1.5 text-center font-medium ${LEVEL_STYLE[level].color}`}>
                        {LEVEL_STYLE[level].label}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="Where This Company Is Strong" items={interpretation.companyStrengths} color="text-up" />
        <FactorList title="Where This Company Is Weak" items={interpretation.companyWeaknesses} color="text-down" />
      </div>

      <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-3">
        <h3 className="text-xs font-semibold text-yellow-300">Biggest Competitive Threat</h3>
        <p className="mt-1 text-xs text-gray-300">{interpretation.biggestCompetitiveThreat}</p>
      </div>

      <p className="text-sm text-gray-300">{interpretation.overallConclusion}</p>

      <p className="text-[11px] text-gray-500">
        Financial figures are real, calculated data. Market-share is not tracked in this app — any
        mention of "gaining or losing ground" is inferred from real growth-rate comparisons, not a market-share
        statistic.
      </p>
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
