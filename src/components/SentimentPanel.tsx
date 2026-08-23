"use client";

import { useState } from "react";
import type { SentimentDirection, SentimentResult, SentimentTrend } from "@/lib/sentiment-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: SentimentResult };

const DIRECTION_STYLE: Record<SentimentDirection, { label: string; color: string; bg: string }> = {
  bullish: { label: "BULLISH", color: "text-up", bg: "bg-up/10" },
  bearish: { label: "BEARISH", color: "text-down", bg: "bg-down/10" },
  neutral: { label: "NEUTRAL", color: "text-gray-300", bg: "bg-gray-500/10" },
};

const TREND_LABEL: Record<SentimentTrend, string> = {
  strongly_improving: "STRONGLY IMPROVING",
  improving: "IMPROVING",
  stable: "STABLE",
  deteriorating: "DETERIORATING",
  strongly_deteriorating: "STRONGLY DETERIORATING",
};

const TREND_COLOR: Record<SentimentTrend, string> = {
  strongly_improving: "text-up",
  improving: "text-up",
  stable: "text-gray-300",
  deteriorating: "text-down",
  strongly_deteriorating: "text-down",
};

/**
 * On-demand (button-triggered) — this agent's own AI call, plus it
 * depends on Step 7's News Intelligence which makes its own AI call, so
 * running this costs two AI calls. Leads with the score/direction and
 * plain-language conclusion, then "what people like / are worried
 * about", then trend and the reality-check comparisons.
 */
export function SentimentPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/sentiment/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Sentiment analysis failed." });
        return;
      }
      setState({ status: "success", data: body as SentimentResult });
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
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Investor Sentiment</h2>
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
          Reads real, already-analyzed news coverage and compares it against actual price movement and
          financial performance to judge how investors currently feel about the stock — and whether that
          feeling matches reality. This combines two AI steps (news analysis, then sentiment synthesis)
          and can take a minute or two.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: SentimentResult }) {
  const { interpretation, marketReaction, fundamentalsSignal, newsEventCount } = result;
  const directionStyle = DIRECTION_STYLE[interpretation.sentimentDirection];

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* Rating + score, leading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`rounded-lg px-4 py-2 ${directionStyle.bg}`}>
          <div className={`text-sm font-bold tracking-wide ${directionStyle.color}`}>{directionStyle.label}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Sentiment Score</div>
          <div className={`text-2xl font-semibold tabular-nums ${directionStyle.color}`}>
            {interpretation.sentimentScore > 0 ? "+" : ""}
            {interpretation.sentimentScore}/100
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
          <span className="text-[11px] text-gray-500">
            based on {newsEventCount} recent news event{newsEventCount === 1 ? "" : "s"} · confidence:{" "}
            {(interpretation.confidenceScore * 100).toFixed(0)}%
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-300">{interpretation.overallConclusion}</p>
      </div>

      {/* What People Like / Are Worried About */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="What People Like" items={interpretation.positiveFactors} color="text-up" />
        <FactorList title="What People Are Worried About" items={interpretation.negativeFactors} color="text-down" />
      </div>

      {interpretation.majorSentimentDrivers.length > 0 && (
        <FactorList title="Biggest Sentiment Drivers" items={interpretation.majorSentimentDrivers} color="text-gray-300" />
      )}

      {/* Sentiment Trend */}
      <div>
        <h3 className="mb-1 text-xs font-semibold text-gray-200">Sentiment Trend</h3>
        <p className={`text-sm font-bold tracking-wide ${TREND_COLOR[interpretation.sentimentTrend]}`}>
          {TREND_LABEL[interpretation.sentimentTrend]}
        </p>
        <p className="mt-1 text-xs text-gray-400">{interpretation.sentimentTrendExplanation}</p>
      </div>

      {/* Reality-check comparisons */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <AssessmentCard title="Market Reaction" assessment={interpretation.marketReaction} />
        <AssessmentCard title="Sentiment vs. Actual Performance" assessment={interpretation.sentimentVsFundamentals} />
        <AssessmentCard title="Sentiment vs. Price" assessment={interpretation.sentimentVsValuation} />
      </div>

      {/* Underlying real signals, small print */}
      <div className="border-t border-border pt-3 text-[11px] text-gray-500">
        <span className="mr-1 rounded bg-blue-900/40 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-blue-300">
          Calculation
        </span>
        Recent price change:{" "}
        {marketReaction.recentPriceChangePct !== null ? `${marketReaction.recentPriceChangePct.toFixed(1)}%` : "n/a"} ·
        Volume vs. average:{" "}
        {marketReaction.volumeVsAverage !== null ? `${(marketReaction.volumeVsAverage * 100).toFixed(0)}%` : "n/a"} ·
        Revenue growth:{" "}
        {fundamentalsSignal.latestRevenueGrowthPct !== null
          ? `${fundamentalsSignal.latestRevenueGrowthPct.toFixed(1)}%`
          : "n/a"}
      </div>

      <p className="text-[11px] text-gray-500">
        This reflects how sources are currently covering the stock, not a guarantee of future price
        movement. No social media data is used — only real news coverage and real price/financial data.
      </p>
    </div>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">None identified.</p>
      ) : (
        <ul className="space-y-1 text-xs text-gray-300">
          {items.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentCard({
  title,
  assessment,
}: {
  title: string;
  assessment: { whatIsHappening: string; why: string; whyItMatters: string };
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <h3 className="text-xs font-semibold text-gray-200">{title}</h3>
      <dl className="mt-1.5 flex flex-col gap-1 text-xs text-gray-400">
        <div>
          <dt className="inline font-medium text-gray-300">What&apos;s happening: </dt>
          <dd className="inline">{assessment.whatIsHappening}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Why: </dt>
          <dd className="inline">{assessment.why}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Why it matters: </dt>
          <dd className="inline">{assessment.whyItMatters}</dd>
        </div>
      </dl>
    </div>
  );
}
