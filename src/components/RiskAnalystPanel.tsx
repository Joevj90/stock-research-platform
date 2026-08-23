"use client";

import { useState } from "react";
import type { RiskAnalysisResult, RiskItem, RiskLevel, RiskSeverity, RiskProbability } from "@/lib/risk-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: RiskAnalysisResult };

const LEVEL_STYLE: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  low: { label: "LOW RISK", color: "text-up", bg: "bg-up/10" },
  medium: { label: "MEDIUM RISK", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  high: { label: "HIGH RISK", color: "text-down", bg: "bg-down/10" },
  very_high: { label: "VERY HIGH RISK", color: "text-down", bg: "bg-down/10" },
};

const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  low: "text-gray-400",
  medium: "text-yellow-400",
  high: "text-orange-400",
  very_high: "text-down",
};

const PROBABILITY_LABEL: Record<RiskProbability, string> = { low: "Low", medium: "Medium", high: "High" };

/**
 * On-demand (button-triggered) — reuses News Intelligence's classified
 * events (1 AI call) plus its own interpretation call (1 more), so
 * running this costs two AI calls total, same order of magnitude as
 * Sentiment Analysis. Leads with the risk score/level, then the #1 risk,
 * then the 3-5 biggest risks, then what would change the AI's mind.
 */
export function RiskAnalystPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/risk/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Risk analysis failed." });
        return;
      }
      setState({ status: "success", data: body as RiskAnalysisResult });
    } catch {
      setState({
        status: "error",
        message: "This took too long to finish. Try again — it combines two AI steps and can take a minute or two.",
      });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          What Could Go Wrong?
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
          Actively challenges the investment case — looking for credible reasons the stock could
          decline, using real financial trends, real market data, and real news coverage. Not a
          generic list of risks; only what&apos;s actually relevant to this company. This combines two AI
          steps (news analysis, then risk synthesis) and can take a minute or two.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: RiskAnalysisResult }) {
  const { interpretation } = result;
  const levelStyle = LEVEL_STYLE[interpretation.riskLevel];

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`rounded-lg px-4 py-2 ${levelStyle.bg}`}>
          <div className={`text-sm font-bold tracking-wide ${levelStyle.color}`}>{levelStyle.label}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Risk Score</div>
          <div className={`text-2xl font-semibold tabular-nums ${levelStyle.color}`}>
            {interpretation.riskScore}/100
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-red-800/40 bg-red-950/20 p-3">
        <h3 className="text-xs font-semibold text-red-300">The #1 Thing That Could Go Wrong</h3>
        <RiskDetail risk={interpretation.numberOneRisk} />
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

      <div>
        <h3 className="mb-2 text-xs font-semibold text-gray-200">Biggest Risks</h3>
        <div className="flex flex-col gap-3">
          {interpretation.biggestRisks.map((risk, i) => (
            <div key={i} className="rounded-lg border border-border bg-bg/40 p-3">
              <RiskDetail risk={risk} showTitle />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-medium text-down">What Would Make the AI More Bearish?</h3>
          {interpretation.whatWouldMakeMoreBearish.length === 0 ? (
            <p className="text-xs text-gray-500">None identified.</p>
          ) : (
            <ul className="space-y-1 text-xs text-gray-300">
              {interpretation.whatWouldMakeMoreBearish.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-up">What Would Make the AI Less Worried?</h3>
          {interpretation.whatWouldMakeLessWorried.length === 0 ? (
            <p className="text-xs text-gray-500">None identified.</p>
          ) : (
            <ul className="space-y-1 text-xs text-gray-300">
              {interpretation.whatWouldMakeLessWorried.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Severity (how bad) and probability (how likely) are judged separately — a low-probability risk
        can still be rated very severe. These are the AI&apos;s assessment, not a guarantee of what will
        happen.
      </p>
    </div>
  );
}

function RiskDetail({ risk, showTitle }: { risk: RiskItem; showTitle?: boolean }) {
  return (
    <div>
      {showTitle && <h4 className="text-sm font-medium text-gray-100">{risk.risk}</h4>}
      {!showTitle && <p className="mt-1 text-sm font-medium text-gray-100">{risk.risk}</p>}
      <div className="mt-1.5 flex gap-3 text-[11px]">
        <span className={`font-semibold uppercase ${SEVERITY_COLOR[risk.severity]}`}>
          Severity: {risk.severity.replace("_", " ")}
        </span>
        <span className="font-semibold uppercase text-gray-400">
          Probability: {PROBABILITY_LABEL[risk.probability]}
        </span>
      </div>
      <dl className="mt-2 flex flex-col gap-1 text-xs text-gray-400">
        <div>
          <dt className="inline font-medium text-gray-300">Why it matters: </dt>
          <dd className="inline">{risk.evidence}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Possible impact: </dt>
          <dd className="inline">{risk.potentialImpact}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Watch for: </dt>
          <dd className="inline">{risk.whatWouldConfirmIt}</dd>
        </div>
      </dl>
    </div>
  );
}
