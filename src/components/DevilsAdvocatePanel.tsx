"use client";

import { useState } from "react";
import type {
  ChallengeLevel,
  DevilsAdvocateResult,
  ThesisChangeVerdict,
} from "@/lib/devils-advocate-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: DevilsAdvocateResult };

const CHALLENGE_STYLE: Record<ChallengeLevel, { label: string; color: string; bg: string }> = {
  low: { label: "LOW", color: "text-up", bg: "bg-up/10" },
  moderate: { label: "MODERATE", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  high: { label: "HIGH", color: "text-down", bg: "bg-down/10" },
  very_high: { label: "VERY HIGH", color: "text-down", bg: "bg-down/10" },
};

const VERDICT_LABEL: Record<ThesisChangeVerdict, string> = { yes: "YES", no: "NO", possibly: "POSSIBLY" };
const VERDICT_COLOR: Record<ThesisChangeVerdict, string> = {
  yes: "text-down",
  no: "text-up",
  possibly: "text-yellow-400",
};

/**
 * Placed near the Investment Committee section, per spec. On-demand
 * (button-triggered) — depends on both the Committee and Forecasting
 * Agent's real conclusions, making it at least as expensive as either.
 */
export function DevilsAdvocatePanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/devils-advocate/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Devil's Advocate review failed." });
        return;
      }
      setState({ status: "success", data: body as DevilsAdvocateResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Devil&apos;s Advocate — Why Might We Be Wrong?
        </h2>
        <button
          onClick={runAnalysis}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Challenging the thesis…" : "Challenge The Conclusion"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Actively looks for reasons the Investment Committee&apos;s conclusion could be wrong — not
          automatically bearish, just genuinely skeptical. Requires the Committee&apos;s conclusion
          already exists for this stock, so run that first if you haven&apos;t.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: DevilsAdvocateResult }) {
  const { interpretation, committeeReview, originalCommitteeRating, originalCommitteeConfidence } = result;
  const style = CHALLENGE_STYLE[interpretation.challengeLevel];

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            How Strong Is The Case Against Our Conclusion?
          </div>
          <div className={`inline-block mt-1 rounded-lg px-3 py-1.5 text-sm font-bold tracking-wide ${style.bg} ${style.color}`}>
            {style.label}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Challenge Score</div>
          <div className="text-2xl font-semibold tabular-nums text-gray-100">{interpretation.overallChallengeScore}/100</div>
          <div className="text-[10px] text-gray-600">not a bearish score</div>
        </div>
      </div>

      <p className="text-sm text-gray-300">{interpretation.finalConclusion}</p>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">What Could We Be Missing?</h3>
        {interpretation.overlookedRisks.length === 0 && interpretation.majorWeaknesses.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing significant identified.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {interpretation.majorWeaknesses.map((w, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-200">{w.problem}</span>
                  <span
                    className={`font-semibold uppercase ${
                      w.severity === "critical" || w.severity === "high" ? "text-down" : "text-yellow-400"
                    }`}
                  >
                    {w.severity}
                  </span>
                </div>
                <p className="mt-1 text-gray-400">{w.whyItMatters}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-gray-200">What Assumption Worries Us Most?</h3>
        <p className="text-xs text-gray-300">{interpretation.whatAssumptionWorriesMost}</p>
      </div>

      {interpretation.questionableAssumptions.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-gray-200">Other Questionable Assumptions</h3>
          <ul className="space-y-1 text-xs text-gray-300">
            {interpretation.questionableAssumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {interpretation.alternativeInterpretations.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Alternative Interpretations</h3>
          <div className="flex flex-col gap-2">
            {interpretation.alternativeInterpretations.map((alt, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
                <p className="text-gray-500">Fact: {alt.fact}</p>
                <p className="mt-1 text-gray-400">
                  <span className="text-gray-300">Common reading: </span>
                  {alt.commonInterpretation}
                </p>
                <p className="mt-0.5 text-gray-400">
                  <span className="text-gray-300">Alternative: </span>
                  {alt.alternativeInterpretation}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg/40 p-3">
        <h3 className="text-xs font-semibold text-gray-200">
          Could This Change The Rating?{" "}
          <span className={`ml-1 ${VERDICT_COLOR[interpretation.couldThisChangeTheRating]}`}>
            {VERDICT_LABEL[interpretation.couldThisChangeTheRating]}
          </span>
        </h3>
        <p className="mt-1 text-xs text-gray-400">{interpretation.whyChangeOrNot}</p>
      </div>

      <div className={`rounded-lg border p-3 ${committeeReview.wasThesisRevised ? "border-yellow-700/40 bg-yellow-900/10" : "border-border bg-bg/40"}`}>
        <h3 className="text-xs font-semibold text-gray-200">Investment Committee Review</h3>
        {committeeReview.wasThesisRevised ? (
          <>
            <p className="mt-1 text-xs text-yellow-300">
              Rating updated: {originalCommitteeRating.toUpperCase()} ({originalCommitteeConfidence}% confidence) →{" "}
              {committeeReview.revisedRating?.toUpperCase()} ({committeeReview.revisedConfidence}% confidence)
            </p>
            <p className="mt-1 text-xs text-gray-400">{committeeReview.whatChangedAndWhy}</p>
          </>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
            The Committee&apos;s original {originalCommitteeRating.toUpperCase()} rating ({originalCommitteeConfidence}%
            confidence) stands — the weaknesses found were not strong enough to justify a change.
          </p>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        This is the Devil&apos;s Advocate&apos;s critique, not a certainty — it exists to stress-test the
        conclusion, not to replace it.
      </p>
    </div>
  );
}
