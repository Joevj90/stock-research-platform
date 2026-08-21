"use client";

import { useState } from "react";
import type { MacroFactorAssessment, MacroResult, OverallMacroEnvironment } from "@/lib/macro-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: MacroResult };

const ENV_STYLE: Record<OverallMacroEnvironment, { label: string; color: string; bg: string }> = {
  favorable: { label: "FAVORABLE", color: "text-up", bg: "bg-up/10" },
  neutral: { label: "NEUTRAL", color: "text-gray-300", bg: "bg-gray-500/10" },
  unfavorable: { label: "UNFAVORABLE", color: "text-down", bg: "bg-down/10" },
};

/**
 * On-demand (button-triggered) since it calls a paid AI API. Leads with
 * FAVORABLE/NEUTRAL/UNFAVORABLE + score and the plain-language
 * conclusion, then What's Helping / What's Hurting, then the biggest
 * risk — kept intentionally light on raw statistics per the spec.
 */
export function MacroAnalysisPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/macro/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Macro analysis failed." });
        return;
      }
      setState({ status: "success", data: body as MacroResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          How Is the Economy Affecting This Stock?
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
          Looks at real economic data (interest rates, inflation, growth, employment) and judges which
          of it actually matters for this specific company — not a generic economic report.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: MacroResult }) {
  const { interpretation, indicators, companyName } = result;
  const envStyle = ENV_STYLE[interpretation.overallMacroEnvironment];

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`rounded-lg px-4 py-2 ${envStyle.bg}`}>
          <div className={`text-sm font-bold tracking-wide ${envStyle.color}`}>{envStyle.label}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Macro Score</div>
          <div className={`text-2xl font-semibold tabular-nums ${envStyle.color}`}>
            {interpretation.macroScore > 0 ? "+" : ""}
            {interpretation.macroScore}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
          <span className="text-[11px] text-gray-500">
            {companyName ?? result.ticker} · confidence: {(interpretation.confidenceScore * 100).toFixed(0)}%
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-300">{interpretation.overallConclusion}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorColumn title="What's Helping?" factors={interpretation.positiveFactors} color="text-up" />
        <FactorColumn title="What's Hurting?" factors={interpretation.negativeFactors} color="text-down" />
      </div>

      <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-3">
        <h3 className="text-xs font-semibold text-yellow-300">Biggest Economic Risk</h3>
        <p className="mt-1 text-xs text-gray-300">{interpretation.biggestMacroRisk.whatCouldHappen}</p>
        <p className="mt-1 text-xs text-gray-400">{interpretation.biggestMacroRisk.whyItWouldMatter}</p>
      </div>

      {interpretation.importantMacroRisks.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Other Important Risks to Watch</h3>
          <ul className="space-y-1.5 text-xs text-gray-300">
            {interpretation.importantMacroRisks.map((r, i) => (
              <li key={i}>
                • {r.whatCouldHappen} <span className="text-gray-500">— {r.whyItWouldMatter}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-border pt-3 text-[11px] text-gray-500">
        <span className="mr-1 rounded bg-blue-900/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-blue-300">
          Fact
        </span>
        {indicators.map((ind) => (
          <span key={ind.name} className="mr-3">
            {ind.label}: {ind.value}
            {ind.unit}
          </span>
        ))}
      </div>

      <p className="text-[11px] text-gray-500">
        This reflects current economic conditions, not a prediction of what will happen next.
      </p>
    </div>
  );
}

function FactorColumn({
  title,
  factors,
  color,
}: {
  title: string;
  factors: MacroFactorAssessment[];
  color: string;
}) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      {factors.length === 0 ? (
        <p className="text-xs text-gray-500">None identified.</p>
      ) : (
        <ul className="space-y-2 text-xs text-gray-300">
          {factors.map((f, i) => (
            <li key={i}>
              <span className="font-medium text-gray-200">{f.factor}: </span>
              {f.whyItMattersToCompany}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
