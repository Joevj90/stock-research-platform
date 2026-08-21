"use client";

import { useState } from "react";
import type { HistoricalPeriod } from "@/lib/types";
import type { TechnicalAnalysisResult } from "@/server/agents/technical-analysis";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: TechnicalAnalysisResult };

const TREND_COLOR: Record<string, string> = {
  strong_uptrend: "text-up",
  uptrend: "text-up",
  sideways: "text-gray-300",
  downtrend: "text-down",
  strong_downtrend: "text-down",
};

/**
 * Runs the Technical Analysis Agent on demand (button click, not
 * automatic) since it calls a paid AI API. Everything under "Calculated
 * Metrics" comes straight from deterministic code; everything under "AI
 * Interpretation" comes from the model's reading of those numbers — the
 * two sections are kept visually and structurally separate throughout.
 */
export function TechnicalAnalysisPanel({
  ticker,
  period,
}: {
  ticker: string;
  period: HistoricalPeriod;
}) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/technical-analysis/${ticker}?period=${period}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Analysis failed." });
        return;
      }
      setState({ status: "success", data: body as TechnicalAnalysisResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Technical Analysis Agent
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
          Computes SMA/EMA/RSI/MACD/Bollinger/ATR/volume/volatility/momentum/support/resistance
          deterministically, then asks AI to interpret those numbers (never to calculate them).
        </p>
      )}

      {state.status === "error" && (
        <p className="mt-3 text-sm text-red-400">{state.message}</p>
      )}

      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: TechnicalAnalysisResult }) {
  const { calculated, interpretation } = result;

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* AI interpretation */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
          <span className="text-[11px] text-gray-500">model: {interpretation.model}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Trend" value={interpretation.trend.replace(/_/g, " ")} className={TREND_COLOR[interpretation.trend]} />
          <Field label="Momentum" value={interpretation.momentum} />
          <Field
            label="Technical Score"
            value={`${interpretation.technicalScore > 0 ? "+" : ""}${interpretation.technicalScore}`}
            className={interpretation.technicalScore >= 0 ? "text-up" : "text-down"}
          />
        </div>

        <p className="mt-3 text-sm text-gray-300">{interpretation.explanation}</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SignalList title="Bullish signals" signals={interpretation.bullishSignals} color="text-up" />
          <SignalList title="Bearish signals" signals={interpretation.bearishSignals} color="text-down" />
        </div>
      </div>

      {/* Calculated metrics */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
            Calculated Metrics
          </span>
          <span className="text-[11px] text-gray-500">
            {calculated.barsUsed} bars · as of {new Date(calculated.asOf).toLocaleDateString()}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-6">
          <Field label="SMA 20" value={fmt(calculated.sma20)} />
          <Field label="SMA 50" value={fmt(calculated.sma50)} />
          <Field label="SMA 100" value={fmt(calculated.sma100)} />
          <Field label="SMA 200" value={fmt(calculated.sma200)} />
          <Field label="EMA 20" value={fmt(calculated.ema20)} />
          <Field label="RSI 14" value={fmt(calculated.rsi14, 1)} />
          <Field label="MACD Line" value={fmt(calculated.macd.line)} />
          <Field label="MACD Signal" value={fmt(calculated.macd.signal)} />
          <Field label="MACD Hist" value={fmt(calculated.macd.histogram)} />
          <Field label="BB Upper" value={fmt(calculated.bollingerBands.upper)} />
          <Field label="BB Lower" value={fmt(calculated.bollingerBands.lower)} />
          <Field label="ATR 14" value={fmt(calculated.atr14)} />
          <Field
            label="Volume vs Avg"
            value={calculated.volumeTrend.ratio !== null ? `${(calculated.volumeTrend.ratio * 100).toFixed(0)}%` : "—"}
          />
          <Field
            label="Volatility (ann.)"
            value={calculated.volatilityAnnualizedPct !== null ? `${calculated.volatilityAnnualizedPct.toFixed(1)}%` : "—"}
          />
          <Field
            label="Momentum (10d)"
            value={calculated.momentum.rateOfChange10Pct !== null ? `${calculated.momentum.rateOfChange10Pct.toFixed(1)}%` : "—"}
          />
        </dl>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LevelList title="Support levels" levels={calculated.supportLevels} />
          <LevelList title="Resistance levels" levels={calculated.resistanceLevels} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`tabular-nums ${className ?? "text-gray-200"}`}>{value}</dd>
    </div>
  );
}

function SignalList({ title, signals, color }: { title: string; signals: string[]; color: string }) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      {signals.length === 0 ? (
        <p className="text-xs text-gray-500">None identified.</p>
      ) : (
        <ul className="space-y-1 text-xs text-gray-300">
          {signals.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LevelList({ title, levels }: { title: string; levels: number[] }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-gray-400">{title}</h3>
      {levels.length === 0 ? (
        <p className="text-xs text-gray-500">None detected.</p>
      ) : (
        <p className="text-xs tabular-nums text-gray-300">{levels.map((l) => `$${l.toFixed(2)}`).join("  ·  ")}</p>
      )}
    </div>
  );
}

function fmt(value: number | null, decimals = 2): string {
  return value === null ? "—" : value.toFixed(decimals);
}
