"use client";

import { useEffect, useState } from "react";
import type { AccuracyDashboard, PredictionHistoryResult, PredictionRecord } from "@/lib/prediction-types";
import type { ForecastHorizonKey } from "@/lib/forecast-types";

type HistoryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: PredictionHistoryResult };

type DashboardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: AccuracyDashboard };

const HORIZON_LABEL: Record<ForecastHorizonKey, string> = {
  "3_month": "3 Months",
  "6_month": "6 Months",
  "12_month": "12 Months",
};

/**
 * Tracks every forecast this app has ever made and grades it against
 * what actually happened. On-demand — loading this panel triggers
 * evaluation of any predictions whose horizon has passed, then shows
 * both this ticker's history/graph and the app-wide accuracy dashboard.
 * "Was the AI right?" should be answerable at a glance.
 */
export function PredictionAccuracyPanel({ ticker }: { ticker: string }) {
  const [historyState, setHistoryState] = useState<HistoryState>({ status: "idle" });
  const [dashboardState, setDashboardState] = useState<DashboardState>({ status: "idle" });

  async function load() {
    setHistoryState({ status: "loading" });
    setDashboardState({ status: "loading" });
    try {
      const [historyRes, dashboardRes] = await Promise.all([
        fetch(`/api/predictions/${ticker}`),
        fetch(`/api/predictions/accuracy`),
      ]);
      const historyBody = await historyRes.json();
      const dashboardBody = await dashboardRes.json();

      if (!historyRes.ok) {
        setHistoryState({ status: "error", message: historyBody.error?.message ?? "Failed to load history." });
      } else {
        setHistoryState({ status: "success", data: historyBody as PredictionHistoryResult });
      }
      setDashboardState({ status: "success", data: dashboardBody as AccuracyDashboard });
    } catch {
      setHistoryState({ status: "error", message: "Something went wrong. Try again." });
      setDashboardState({ status: "idle" });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Prediction Accuracy — Was The AI Right?
        </h2>
        <button
          onClick={load}
          disabled={historyState.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {historyState.status === "loading" ? "Checking…" : "Check Accuracy"}
        </button>
      </div>

      {historyState.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Every forecast this app makes is permanently recorded and later checked against what actually
          happened — never rewritten, never graded early. Click to see how this stock&apos;s predictions
          have performed, and how accurate the AI has been overall.
        </p>
      )}
      {historyState.status === "error" && <p className="mt-3 text-sm text-red-400">{historyState.message}</p>}
      {historyState.status === "success" && (
        <div className="mt-4 flex flex-col gap-6">
          <TickerHistory result={historyState.data} />
          {dashboardState.status === "success" && <AccuracyDashboardView dashboard={dashboardState.data} />}
        </div>
      )}
    </section>
  );
}

function TickerHistory({ result }: { result: PredictionHistoryResult }) {
  if (result.predictions.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No predictions recorded for {result.ticker} yet — run the Forecasting Agent to create one.
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-gray-200">{result.ticker} Prediction History</h3>
      <PredictionChart predictions={result.predictions} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pr-3 py-1.5">Date</th>
              <th className="px-2 py-1.5">Horizon</th>
              <th className="px-2 py-1.5 text-right">AI Predicted</th>
              <th className="px-2 py-1.5 text-right">Actual</th>
              <th className="px-2 py-1.5">Result</th>
            </tr>
          </thead>
          <tbody>
            {result.predictions.map((p) => (
              <tr key={p.id} className="border-t border-border/50">
                <td className="py-1.5 pr-3">{new Date(p.predictionDate).toLocaleDateString()}</td>
                <td className="px-2 py-1.5">{HORIZON_LABEL[p.horizon]}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${p.expectedPrice}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {p.actualPrice !== null ? `$${p.actualPrice.toFixed(2)}` : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {p.directionCorrect === null ? (
                    <span className="text-gray-500">Pending ({new Date(p.evaluationDueDate).toLocaleDateString()})</span>
                  ) : p.directionCorrect ? (
                    <span className="font-medium text-up">Correct</span>
                  ) : (
                    <span className="font-medium text-down">Wrong</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Simple SVG line chart comparing what the AI predicted vs. what
 * actually happened, per the spec's explicit emphasis on this being one
 * of the most important features. Only plots predictions that have
 * either an actual price (evaluated) or a target we can still show as
 * pending — never redraws using information the AI didn't have when it
 * made the call. */
function PredictionChart({ predictions }: { predictions: PredictionRecord[] }) {
  const width = 600;
  const height = 180;
  const padding = 30;

  const allPrices = predictions.flatMap((p) => [p.priceAtPrediction, p.expectedPrice, p.actualPrice].filter((v): v is number => v !== null));
  if (allPrices.length === 0) return null;

  const minPrice = Math.min(...allPrices) * 0.95;
  const maxPrice = Math.max(...allPrices) * 1.05;
  const priceRange = maxPrice - minPrice || 1;

  const dates = predictions.map((p) => new Date(p.predictionDate).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates, ...predictions.map((p) => new Date(p.evaluationDueDate).getTime()));
  const dateRange = maxDate - minDate || 1;

  const x = (date: number) => padding + ((date - minDate) / dateRange) * (width - padding * 2);
  const y = (price: number) => height - padding - ((price - minPrice) / priceRange) * (height - padding * 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-md bg-bg/40">
      {predictions.map((p, i) => {
        const predictionX = x(new Date(p.predictionDate).getTime());
        const dueX = x(new Date(p.evaluationDueDate).getTime());
        const startY = y(p.priceAtPrediction);
        const predictedY = y(p.expectedPrice);
        const actualY = p.actualPrice !== null ? y(p.actualPrice) : null;

        return (
          <g key={p.id}>
            {/* AI predicted line: prediction date/price -> due date/expected price */}
            <line x1={predictionX} y1={startY} x2={dueX} y2={predictedY} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 3" />
            <circle cx={predictionX} cy={startY} r={3} fill="#9ca3af" />
            <circle cx={dueX} cy={predictedY} r={3} fill="#60a5fa" />
            {/* Actual line, if evaluated */}
            {actualY !== null && (
              <>
                <line x1={predictionX} y1={startY} x2={dueX} y2={actualY} stroke={p.directionCorrect ? "#4ade80" : "#f87171"} strokeWidth={2} />
                <circle cx={dueX} cy={actualY} r={3.5} fill={p.directionCorrect ? "#4ade80" : "#f87171"} />
              </>
            )}
            {i === 0 && (
              <text x={predictionX} y={height - 8} fontSize={9} fill="#6b7280">
                {new Date(p.predictionDate).toLocaleDateString()}
              </text>
            )}
          </g>
        );
      })}
      <text x={width - padding - 60} y={14} fontSize={9} fill="#60a5fa">— · — AI Predicted</text>
      <text x={width - padding - 60} y={26} fontSize={9} fill="#4ade80">— Actual (correct)</text>
      <text x={width - padding - 60} y={38} fontSize={9} fill="#f87171">— Actual (wrong)</text>
    </svg>
  );
}

function AccuracyDashboardView({ dashboard }: { dashboard: AccuracyDashboard }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold text-gray-200">Overall Accuracy (Across All Tracked Stocks)</h3>

      <div className="flex flex-wrap gap-4">
        <Stat label="Predictions Made" value={String(dashboard.totalPredictions)} />
        <Stat label="Evaluated" value={String(dashboard.evaluatedPredictions)} />
        <Stat label="Pending" value={String(dashboard.pendingPredictions)} />
        {dashboard.overallDirectionAccuracyPct !== null ? (
          <Stat label="Direction Accuracy" value={`${dashboard.overallDirectionAccuracyPct.toFixed(0)}%`} />
        ) : null}
      </div>

      {dashboard.overallDirectionAccuracyPct === null ? (
        <p className="mt-2 text-xs text-gray-500">{dashboard.insufficientSampleMessage}</p>
      ) : (
        <p className="mt-2 text-xs text-gray-400">
          The AI correctly predicted whether the stock would rise or fall in {dashboard.correctCount} out of{" "}
          {dashboard.evaluatedPredictions} completed predictions.
        </p>
      )}

      <div className="mt-3">
        <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Accuracy By Time Horizon</h4>
        <div className="flex gap-3 text-xs">
          {dashboard.accuracyByHorizon.map((h) => (
            <div key={h.horizon}>
              <span className="text-gray-500">{HORIZON_LABEL[h.horizon]}: </span>
              <span className="font-medium text-gray-200">
                {h.directionAccuracyPct !== null ? `${h.directionAccuracyPct.toFixed(0)}%` : "Not enough data"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-bg/40 p-2.5 text-xs">
        <span className="font-medium text-gray-200">Is The AI Too Confident? </span>
        <span
          className={
            dashboard.confidenceCalibration.verdict === "overconfident"
              ? "text-down"
              : dashboard.confidenceCalibration.verdict === "insufficient_data"
                ? "text-gray-500"
                : "text-up"
          }
        >
          {dashboard.confidenceCalibration.verdict.replace(/_/g, " ").toUpperCase()}
        </span>
        <p className="mt-1 text-gray-400">{dashboard.confidenceCalibration.explanation}</p>
      </div>

      <div className="mt-3 rounded-md border border-yellow-700/40 bg-yellow-900/10 p-2.5 text-xs">
        <span className="font-semibold uppercase tracking-wide text-yellow-300">
          {dashboard.simulatedPerformance.label}
        </span>
        {dashboard.simulatedPerformance.evaluatedCount === 0 ? (
          <p className="mt-1 text-gray-400">No completed predictions yet.</p>
        ) : (
          <p className="mt-1 text-gray-300">
            Average return per prediction: {dashboard.simulatedPerformance.averageReturnPct?.toFixed(1)}% ·{" "}
            {dashboard.simulatedPerformance.winningCount} winning, {dashboard.simulatedPerformance.losingCount} losing
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-gray-100">{value}</div>
    </div>
  );
}
