"use client";

import { SP500_TICKERS } from "@/data/sp500-tickers";
import Link from "next/link";
import { useScreener } from "@/hooks/useScreener";
import type { ScreenerHit } from "@/lib/screener-types";

/**
 * The S&P 500 Valuation Screener. Two visible phases, matching the
 * two-phase scan `useScreener` actually runs: a fast, no-AI valuation
 * pass across the whole index, then a slower, AI-backed 1-month
 * forecast pass on only the shortlist that pass Phase 1 -- shown
 * separately so the person watching understands why the second phase is
 * slower and why it doesn't cover all 500 tickers.
 */
export function ScreenerPanel() {
  const { state, runScreen } = useScreener();

  return (
    <section className="rounded-xl border-2 border-accent/50 bg-panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-200">S&amp;P 500 Valuation Screener</h2>
          <p className="mt-1 text-xs text-gray-500">
            Finds S&amp;P 500 stocks the AI expects to return more than 10% over the next month.
          </p>
        </div>
        <button
          onClick={runScreen}
          disabled={state.status === "scanning_valuation" || state.status === "scanning_forecasts"}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "scanning_valuation" || state.status === "scanning_forecasts" ? "Scanning…" : "Scan S&P 500"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Phase 1 ranks all ~500 S&amp;P 500 stocks by real DCF valuation gap (no AI cost). Phase 2 runs the same
          Forecasting Agent used by &quot;Analyze Stock&quot; on only the top 25 candidates from Phase 1, and checks
          each one&apos;s real 1-month expected return. The whole scan can take several minutes, mostly during Phase 2.
        </p>
      )}

      {state.status === "scanning_valuation" && (
        <div className="mt-4">
          <ProgressBar label="Phase 1 — scanning valuation" done={state.scanned} total={state.total} />
          <p className="mt-1 text-[11px] text-gray-500">No AI cost yet — checking real DCF fair value vs. price.</p>
        </div>
      )}

      {state.status === "scanning_forecasts" && (
        <div className="mt-4">
          <ProgressBar label="Phase 2 — AI forecasting shortlist" done={state.completed} total={state.total} />
          <p className="mt-1 text-[11px] text-gray-500">
            Running the real Forecasting Agent on the top {state.total} valuation candidates.
          </p>
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-3">
          <p className="text-sm text-red-400">{state.message}</p>
          <p className="mt-1 text-xs text-gray-500">Clicking &quot;Scan S&amp;P 500&quot; will start over from the beginning.</p>
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-5 flex flex-col gap-5">
          <p className="text-xs text-gray-500">
            Scanned {state.scannedCount} of {SP500_TICKERS.length} tickers
            {state.failedTickers.length > 0 && ` (${state.failedTickers.length} skipped — data unavailable)`}. Ran the
            AI forecast on the top {state.shortlist.length} by valuation gap.
          </p>

          {state.hits.length === 0 ? (
            <p className="text-sm text-gray-400">
              None of the top {state.shortlist.length} candidates cleared a +10% expected return over the next
              month. See the full shortlist below for the closest ones.
            </p>
          ) : (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-up">
                Above +10% expected in 1 month ({state.hits.length})
              </h3>
              <HitsTable hits={state.hits} highlight />
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Full shortlist (top {state.shortlist.length} by valuation gap)
            </h3>
            <HitsTable hits={state.shortlist} highlight={false} />
          </div>

          <p className="text-[11px] text-gray-500">
            All figures are AI-generated estimates based on available data, not guarantees. Each ticker above was
            also recorded in Prediction Tracking, same as any other forecast run from this app.
          </p>
        </div>
      )}
    </section>
  );
}

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className="tabular-nums text-gray-500">
          {done} / {total}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg/60">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HitsTable({ hits, highlight }: { hits: ScreenerHit[]; highlight: boolean }) {
  if (hits.length === 0) {
    return <p className="text-xs text-gray-500">None.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-gray-500">
            <th className="px-2 py-1.5 font-medium">Ticker</th>
            <th className="px-2 py-1.5 font-medium">Price</th>
            <th className="px-2 py-1.5 font-medium">1-Month Target</th>
            <th className="px-2 py-1.5 font-medium">Expected Return</th>
            <th className="px-2 py-1.5 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h) => (
            <tr key={h.ticker} className={`border-t border-border ${highlight ? "bg-up/5" : ""}`}>
              <td className="px-2 py-1.5">
                <Link href={`/stock/${h.ticker}`} className="font-medium text-gray-100 hover:text-accent">
                  {h.ticker}
                </Link>
                {h.companyName && <div className="text-[10px] text-gray-500">{h.companyName}</div>}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-gray-300">${h.currentPrice.toFixed(2)}</td>
              <td className="px-2 py-1.5 tabular-nums text-gray-300">${h.expectedPrice}</td>
              <td className={`px-2 py-1.5 tabular-nums font-semibold ${h.expectedReturnPct >= 0 ? "text-up" : "text-down"}`}>
                {h.expectedReturnPct >= 0 ? "+" : ""}
                {h.expectedReturnPct}%
                {!h.dataSupportsThisHorizon && (
                  <span className="ml-1 text-[10px] font-normal text-yellow-400" title={h.limitationNote ?? undefined}>
                    ⚠ low data
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-gray-400">{h.confidenceScore}/100</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
