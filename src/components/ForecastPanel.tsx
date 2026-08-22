"use client";

import { useState } from "react";
import type { ForecastHorizonKey, ForecastResult, ScenarioOutcome } from "@/lib/forecast-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: ForecastResult };

const HORIZON_LABEL: Record<ForecastHorizonKey, string> = {
  "3_month": "3 Months",
  "6_month": "6 Months",
  "12_month": "12 Months",
};

const HORIZON_ORDER: ForecastHorizonKey[] = ["3_month", "6_month", "12_month"];

const INPUT_LABELS: { key: keyof ForecastResult["inputsUsed"]; label: string }[] = [
  { key: "technical", label: "Technical" },
  { key: "fundamental", label: "Fundamental" },
  { key: "valuation", label: "Valuation" },
  { key: "sentiment", label: "Sentiment" },
  { key: "macro", label: "Macro" },
  { key: "competitor", label: "Competitor" },
  { key: "management", label: "Management" },
  { key: "risk", label: "Risk" },
];

/**
 * On-demand (button-triggered) — this is the most expensive single
 * action in the app, since it combines real outputs from up to 8 other
 * AI agents plus its own synthesis call. The UI says so plainly before
 * the user clicks.
 */
export function ForecastPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [activeHorizon, setActiveHorizon] = useState<ForecastHorizonKey>("6_month");

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/forecast/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Forecast failed." });
        return;
      }
      setState({ status: "success", data: body as ForecastResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Where Could This Stock Go?
        </h2>
        <button
          onClick={runAnalysis}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Combining all analyses…" : "Run Forecast"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Combines real results from every other analysis on this page — technical, fundamental,
          valuation, sentiment, macro, competitor, management, and risk — into bear/base/bull price
          scenarios. This is the most thorough (and slowest) analysis in the app; it can take up to a
          minute.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && (
        <ResultView result={state.data} activeHorizon={activeHorizon} setActiveHorizon={setActiveHorizon} />
      )}
    </section>
  );
}

function ResultView({
  result,
  activeHorizon,
  setActiveHorizon,
}: {
  result: ForecastResult;
  activeHorizon: ForecastHorizonKey;
  setActiveHorizon: (h: ForecastHorizonKey) => void;
}) {
  const { interpretation, currentPrice, inputsUsed } = result;
  const horizon = interpretation.horizons.find((h) => h.horizon === activeHorizon)!;

  const usedCount = INPUT_LABELS.filter((i) => inputsUsed[i.key]).length;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="text-[11px] text-gray-500">
        Built from {usedCount} of {INPUT_LABELS.length} available analyses:{" "}
        {INPUT_LABELS.map((i) => (
          <span key={i.key} className={inputsUsed[i.key] ? "text-gray-300" : "text-gray-700 line-through"}>
            {i.label}
            {i !== INPUT_LABELS[INPUT_LABELS.length - 1] ? ", " : ""}
          </span>
        ))}
      </p>

      <div className="flex gap-1">
        {HORIZON_ORDER.map((h) => (
          <button
            key={h}
            onClick={() => setActiveHorizon(h)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              h === activeHorizon ? "bg-accent text-white" : "text-gray-400 hover:bg-panel hover:text-gray-200"
            }`}
          >
            {HORIZON_LABEL[h]}
          </button>
        ))}
      </div>

      {!horizon.dataSupportsThisHorizon && (
        <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-3 text-xs text-yellow-300">
          {horizon.limitationNote ?? "Not enough data to support a reliable forecast for this time frame."}
        </div>
      )}

      <ScenarioRangeChart currentPrice={currentPrice} bear={horizon.bear} base={horizon.base} bull={horizon.bull} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ScenarioCard scenario={horizon.bear} highlight={horizon.mostLikelyScenario === "bear"} />
        <ScenarioCard scenario={horizon.base} highlight={horizon.mostLikelyScenario === "base"} />
        <ScenarioCard scenario={horizon.bull} highlight={horizon.mostLikelyScenario === "bull"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg/40 p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current Price</div>
          <div className="text-lg font-semibold tabular-nums text-gray-100">${currentPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Expected Price</div>
          <div className="text-lg font-semibold tabular-nums text-gray-100">${horizon.expectedPrice}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Expected Return</div>
          <div className={`text-lg font-semibold tabular-nums ${horizon.expectedReturnPct >= 0 ? "text-up" : "text-down"}`}>
            {horizon.expectedReturnPct >= 0 ? "+" : ""}
            {horizon.expectedReturnPct}%
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Confidence</div>
          <div className="text-lg font-semibold tabular-nums text-gray-100">{interpretation.confidenceScore}/100</div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-300">{interpretation.overallConclusion}</p>
        <p className="mt-1 text-xs text-gray-500">{interpretation.confidenceExplanation}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Key Catalysts (could help)</h3>
          {interpretation.keyCatalysts.length === 0 ? (
            <p className="text-xs text-gray-500">None identified.</p>
          ) : (
            <ul className="space-y-1.5 text-xs text-gray-300">
              {interpretation.keyCatalysts.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-gray-100">{c.whatCouldHappen}</span> — {c.whyItWouldHelp}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Key Risks (could hurt)</h3>
          {interpretation.keyRisksSummary.length === 0 ? (
            <p className="text-xs text-gray-500">None identified.</p>
          ) : (
            <ul className="space-y-1 text-xs text-gray-300">
              {interpretation.keyRisksSummary.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {interpretation.assumptions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Forecast Assumptions</h3>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {interpretation.assumptions.map((a, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-2.5">
                <dt className="text-xs font-medium text-gray-200">{a.assumption}</dt>
                <dd className="mt-0.5 text-xs text-gray-400">{a.explanation}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        These are estimates based on stated assumptions, not guaranteed prices. Prices are rounded to
        avoid implying more precision than the underlying uncertainty supports.
      </p>
    </div>
  );
}

function ScenarioRangeChart({
  currentPrice,
  bear,
  base,
  bull,
}: {
  currentPrice: number;
  bear: ScenarioOutcome;
  base: ScenarioOutcome;
  bull: ScenarioOutcome;
}) {
  const min = Math.min(bear.priceTarget, currentPrice);
  const max = Math.max(bull.priceTarget, currentPrice);
  const range = max - min || 1;
  const pct = (price: number) => ((price - min) / range) * 100;

  return (
    <div className="relative h-10 rounded-md bg-bg/60">
      <div className="absolute inset-y-0 left-0 w-full rounded-md bg-gradient-to-r from-down/20 via-gray-500/10 to-up/20" />
      <Marker label="Bear" price={bear.priceTarget} leftPct={pct(bear.priceTarget)} color="text-down" />
      <Marker label="Base" price={base.priceTarget} leftPct={pct(base.priceTarget)} color="text-gray-200" />
      <Marker label="Bull" price={bull.priceTarget} leftPct={pct(bull.priceTarget)} color="text-up" />
      <Marker label="Now" price={currentPrice} leftPct={pct(currentPrice)} color="text-accent" isCurrent />
    </div>
  );
}

function Marker({
  label,
  price,
  leftPct,
  color,
  isCurrent,
}: {
  label: string;
  price: number;
  leftPct: number;
  color: string;
  isCurrent?: boolean;
}) {
  return (
    <div
      className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${Math.min(98, Math.max(2, leftPct))}%` }}
    >
      <div className={`h-10 w-0.5 ${isCurrent ? "bg-accent" : "bg-gray-500"}`} />
      <div className={`-mt-1 text-[10px] font-medium ${color}`}>
        {label} ${price}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, highlight }: { scenario: ScenarioOutcome; highlight: boolean }) {
  const color = scenario.scenario === "bear" ? "text-down" : scenario.scenario === "bull" ? "text-up" : "text-gray-200";
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-accent bg-accent/5" : "border-border bg-bg/40"}`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-xs font-bold uppercase tracking-wide ${color}`}>{scenario.scenario} case</span>
        <span className="text-[10px] text-gray-500">{scenario.probabilityPct}% likely</span>
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>${scenario.priceTarget}</div>
      <div className={`text-xs tabular-nums ${scenario.expectedReturnPct >= 0 ? "text-up" : "text-down"}`}>
        {scenario.expectedReturnPct >= 0 ? "+" : ""}
        {scenario.expectedReturnPct}%
      </div>
      <p className="mt-2 text-xs text-gray-400">{scenario.explanation}</p>
    </div>
  );
}
