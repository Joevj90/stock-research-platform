"use client";

import { useState } from "react";
import type { FinancialPeriodType, FundamentalsResult } from "@/lib/fundamentals-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: FundamentalsResult };

/**
 * Shows trend summaries ("$100B -> $115B -> $130B") with a plain-English
 * explanation beneath each -- never a raw statement table. Fetched
 * on-demand (button) so a stock page load doesn't automatically spend
 * three more FMP calls beyond the quote/history it already makes.
 */
export function FundamentalsPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [periodType, setPeriodType] = useState<FinancialPeriodType>("annual");

  async function load(type: FinancialPeriodType) {
    setPeriodType(type);
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/fundamentals/${ticker}?period=${type}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Failed to load financials." });
        return;
      }
      setState({ status: "success", data: body as FundamentalsResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Financials
        </h2>
        {state.status === "idle" ? (
          <div className="flex gap-1">
            <button
              onClick={() => load("annual")}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              Load Annual
            </button>
            <button
              onClick={() => load("quarterly")}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-panel"
            >
              Load Quarterly
            </button>
          </div>
        ) : (
          <div className="flex gap-1">
            <ToggleButton active={periodType === "annual"} onClick={() => load("annual")}>
              Annual
            </ToggleButton>
            <ToggleButton active={periodType === "quarterly"} onClick={() => load("quarterly")}>
              Quarterly
            </ToggleButton>
          </div>
        )}
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Income statement, balance sheet, and cash flow data from real filings -- with plain-English
          explanations, not just raw numbers.
        </p>
      )}
      {state.status === "loading" && <p className="mt-3 text-xs text-gray-500">Loading…</p>}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-accent text-white" : "text-gray-400 hover:bg-panel hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function ResultView({ result }: { result: FundamentalsResult }) {
  const { periods, metricSeries } = result;

  if (periods.length === 0) {
    return <p className="mt-3 text-sm text-gray-400">No financial statement data available.</p>;
  }

  const anyWarnings = periods.some((p) => p.warnings.length > 0);
  const latest = periods[periods.length - 1]!.period;

  return (
    <div className="mt-4 flex flex-col gap-5">
      <p className="text-[11px] text-gray-500">
        {periods.length} periods · source: {latest.source} · most recent filing:{" "}
        {latest.filingDate ? new Date(latest.filingDate).toLocaleDateString() : "unknown"}
        {latest.reportedCurrency ? ` · ${latest.reportedCurrency}` : ""}
      </p>

      {anyWarnings && (
        <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-300">
          Some periods have data that looks inconsistent (e.g. the balance sheet doesn't quite add up).
          Figures are shown as reported -- treat flagged periods with extra caution.
        </div>
      )}

      <MetricRow series={metricSeries.revenue} />
      <MetricRow series={metricSeries.grossProfit} />
      <MetricRow series={metricSeries.operatingIncome} />
      <MetricRow series={metricSeries.netIncome} />
      <MetricRow series={metricSeries.eps} />
      <MetricRow series={metricSeries.cash} />
      <MetricRow series={metricSeries.totalDebt} />
      <MetricRow series={metricSeries.freeCashFlow} />
    </div>
  );
}

function MetricRow({ series }: { series: FundamentalsResult["metricSeries"]["revenue"] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-gray-200">{series.label}</h3>
        <p className="text-xs tabular-nums text-gray-400">{series.formattedValues.join(" → ")}</p>
      </div>
      <p className="mt-1 text-xs text-gray-400">{series.explanation}</p>
    </div>
  );
}
