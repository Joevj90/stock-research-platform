"use client";

import { useState } from "react";
import type {
  DcfScenario,
  MetricValue,
  ValuationRating,
  ValuationResult,
} from "@/lib/valuation-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: ValuationResult };

const RATING_STYLE: Record<ValuationRating, { label: string; color: string; bg: string }> = {
  cheap: { label: "CHEAP", color: "text-up", bg: "bg-up/10" },
  reasonably_priced: { label: "REASONABLY PRICED", color: "text-blue-400", bg: "bg-blue-500/10" },
  expensive: { label: "EXPENSIVE", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  very_expensive: { label: "VERY EXPENSIVE", color: "text-down", bg: "bg-down/10" },
};

const METRIC_LABELS: { key: keyof ValuationResult["metrics"]; label: string; suffix?: string }[] = [
  { key: "peRatio", label: "P/E Ratio" },
  { key: "forwardPeRatio", label: "Forward P/E" },
  { key: "pegRatio", label: "PEG Ratio" },
  { key: "evToEbitda", label: "EV/EBITDA" },
  { key: "evToRevenue", label: "EV/Revenue" },
  { key: "priceToSales", label: "Price/Sales" },
  { key: "priceToBook", label: "Price/Book" },
  { key: "freeCashFlowYieldPct", label: "FCF Yield", suffix: "%" },
  { key: "dividendYieldPct", label: "Dividend Yield", suffix: "%" },
];

/**
 * On-demand (button-triggered) since it calls a paid AI API and does
 * several extra data fetches (peer comparison). Leads with the rating
 * and simple explanation, then progressively more detail — metrics,
 * comparisons, DCF, sensitivity — so a non-expert isn't confronted with
 * everything at once.
 */
export function ValuationPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [showSensitivity, setShowSensitivity] = useState(false);

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/valuation/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Valuation analysis failed." });
        return;
      }
      setState({ status: "success", data: body as ValuationResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Valuation</h2>
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
          Estimates whether the stock looks cheap, reasonably priced, expensive, or very expensive —
          using real valuation ratios, a comparison against its own history and real peer companies,
          and a discounted cash flow (DCF) model with bear/base/bull scenarios.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && (
        <ResultView result={state.data} showSensitivity={showSensitivity} setShowSensitivity={setShowSensitivity} />
      )}
    </section>
  );
}

function ResultView({
  result,
  showSensitivity,
  setShowSensitivity,
}: {
  result: ValuationResult;
  showSensitivity: boolean;
  setShowSensitivity: (v: boolean) => void;
}) {
  const { currentPrice, metrics, historicalComparison, peerComparison, dcf, interpretation } = result;
  const ratingStyle = RATING_STYLE[interpretation.rating];

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* 1 & 2: current price + rating, leading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current Price</div>
          <div className="text-xl font-semibold tabular-nums text-gray-100">${currentPrice.toFixed(2)}</div>
        </div>
        <div className={`rounded-lg px-4 py-2 text-center ${ratingStyle.bg}`}>
          <div className={`text-sm font-bold tracking-wide ${ratingStyle.color}`}>{ratingStyle.label}</div>
        </div>
      </div>

      {/* 10: simple explanation, right after the rating */}
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
            AI Interpretation
          </span>
          <span className="text-[11px] text-gray-500">confidence: {(interpretation.confidenceScore * 100).toFixed(0)}%</span>
        </div>
        <p className="mt-2 text-sm text-gray-300">{interpretation.explanation}</p>
        <p className="mt-2 text-xs text-gray-400">
          <span className="font-medium text-gray-300">Biggest uncertainty: </span>
          {interpretation.biggestUncertainty}
        </p>
      </div>

      {/* 3: key valuation metrics */}
      <div>
        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
          Calculation
        </span>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
          {METRIC_LABELS.map(({ key, label, suffix }) => (
            <MetricCell key={key} label={label} metric={metrics[key] as MetricValue} suffix={suffix} />
          ))}
        </dl>
      </div>

      {/* 4: historical comparison */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Compared to Its Own History</h3>
        <ComparisonLine
          label="P/E vs. historical average"
          pct={historicalComparison.currentPeVsHistoricalAveragePct}
        />
        <ComparisonLine
          label="Price/Sales vs. historical average"
          pct={historicalComparison.currentPsVsHistoricalAveragePct}
        />
      </div>

      {/* 5: competitor/peer comparison */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Compared to Peer Companies</h3>
        {peerComparison.peers.length === 0 ? (
          <p className="text-xs text-gray-500">No peer comparison data available.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">Peers: {peerComparison.peers.map((p) => p.ticker).join(", ")}</p>
            <ComparisonLine label="P/E vs. peer average" pct={peerComparison.currentPeVsPeerAveragePct} />
            <ComparisonLine label="Price/Sales vs. peer average" pct={peerComparison.currentPsVsPeerAveragePct} />
          </>
        )}
      </div>

      {/* 6 & 7: DCF fair value range + bear/base/bull */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Estimated Fair Value (DCF Model)</h3>
        {dcf.fairValueRangeLow !== null && dcf.fairValueRangeHigh !== null ? (
          <p className="text-sm text-gray-300">
            Estimated range:{" "}
            <span className="font-semibold tabular-nums text-gray-100">
              ${dcf.fairValueRangeLow.toFixed(2)} – ${dcf.fairValueRangeHigh.toFixed(2)}
            </span>{" "}
            per share (current price: ${currentPrice.toFixed(2)})
          </p>
        ) : (
          <p className="text-xs text-gray-500">Not enough data to estimate a fair value range.</p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <ScenarioCard scenario={dcf.bear} />
          <ScenarioCard scenario={dcf.base} />
          <ScenarioCard scenario={dcf.bull} />
        </div>
      </div>

      {/* 8: important assumptions */}
      {interpretation.assumptionExplanations.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-gray-200">Important Assumptions (Base Case)</h3>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {interpretation.assumptionExplanations.map((a) => (
              <div key={a.key} className="rounded-lg border border-border bg-bg/40 p-2.5">
                <dt className="text-xs font-medium text-gray-200">
                  {a.label}: {formatAssumptionValue(dcf.base.assumptions, a.key)}
                </dt>
                <dd className="mt-0.5 text-xs text-gray-400">{a.explanation}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 9: sensitivity analysis */}
      <div>
        <button
          onClick={() => setShowSensitivity(!showSensitivity)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {showSensitivity ? "Hide" : "Show"} sensitivity analysis
        </button>
        {showSensitivity && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs text-gray-300">
              <tbody>
                {dcf.sensitivity.map((row) => (
                  <tr key={row.parameter} className="border-t border-border/50">
                    <td className="py-1.5 pr-3 font-medium text-gray-300">{sensitivityLabel(row.parameter)}</td>
                    {row.results.map((r, i) => (
                      <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                        {r.fairValuePerShare !== null ? `$${r.fairValuePerShare.toFixed(0)}` : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-gray-500">
              Each column shows the estimated fair value per share if that one assumption were changed,
              holding everything else at its base-case value.
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        This is an estimate based on the assumptions shown above — not a prediction of future price.
        Different assumptions would produce a different result.
      </p>
    </div>
  );
}

function MetricCell({ label, metric, suffix }: { label: string; metric: MetricValue; suffix?: string }) {
  return (
    <div title={metric.unavailableReason ?? undefined}>
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="tabular-nums text-gray-200">
        {metric.value === null ? "—" : `${metric.value.toFixed(2)}${suffix ?? "x"}`}
      </dd>
    </div>
  );
}

function ComparisonLine({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) {
    return (
      <p className="text-xs text-gray-500">
        {label}: <span className="text-gray-600">not available</span>
      </p>
    );
  }
  const color = pct > 0 ? "text-down" : pct < 0 ? "text-up" : "text-gray-300";
  const direction = pct > 0 ? "more expensive than" : pct < 0 ? "cheaper than" : "in line with";
  return (
    <p className="text-xs text-gray-400">
      {label}:{" "}
      <span className={`font-medium tabular-nums ${color}`}>
        {Math.abs(pct).toFixed(0)}% {direction}
      </span>
    </p>
  );
}

function ScenarioCard({ scenario }: { scenario: DcfScenario }) {
  const label = scenario.name === "bear" ? "Bear" : scenario.name === "base" ? "Base" : "Bull";
  const color = scenario.name === "bear" ? "text-down" : scenario.name === "bull" ? "text-up" : "text-gray-200";
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-2.5 text-center">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${color}`}>{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-100">
        {scenario.fairValuePerShare !== null ? `$${scenario.fairValuePerShare.toFixed(2)}` : "—"}
      </div>
      {scenario.impliedUpsideDownsidePct !== null && (
        <div className={`text-[11px] tabular-nums ${scenario.impliedUpsideDownsidePct >= 0 ? "text-up" : "text-down"}`}>
          {scenario.impliedUpsideDownsidePct >= 0 ? "+" : ""}
          {scenario.impliedUpsideDownsidePct.toFixed(0)}%
        </div>
      )}
    </div>
  );
}

function sensitivityLabel(param: string): string {
  switch (param) {
    case "revenueGrowth":
      return "Revenue growth";
    case "operatingMargin":
      return "Operating margin";
    case "discountRate":
      return "Discount rate";
    case "terminalGrowth":
      return "Terminal growth";
    default:
      return param;
  }
}

function formatAssumptionValue(assumptions: DcfScenario["assumptions"], key: string): string {
  const value = (assumptions as unknown as Record<string, number>)[key];
  if (typeof value !== "number") return "";
  if (key === "projectionYears") return `${value} years`;
  return `${value.toFixed(1)}%`;
}
