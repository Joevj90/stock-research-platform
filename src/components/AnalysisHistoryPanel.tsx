"use client";

import { useState } from "react";
import { useFinalReportGeneration } from "@/hooks/useFinalReportGeneration";
import { StepProgress } from "@/components/FinalReportPanel";
import type {
  AnalysisHistoryResult,
  ComparisonResult,
  SavedAnalysisRecord,
  SavedAnalysisWithReport,
  ThesisChangeLevel,
} from "@/lib/analysis-history-types";
import type { CommitteeRecommendation } from "@/lib/investment-committee-types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: AnalysisHistoryResult };

type ViewState = { open: false } | { open: true; status: "loading" } | { open: true; status: "error"; message: string } | { open: true; status: "success"; data: SavedAnalysisWithReport };

const RATING_LABEL: Record<CommitteeRecommendation, { label: string; color: string }> = {
  buy: { label: "BULLISH", color: "text-up" },
  hold: { label: "NEUTRAL", color: "text-gray-300" },
  sell: { label: "BEARISH", color: "text-down" },
};

const THESIS_CHANGE_LABEL: Record<ThesisChangeLevel, { label: string; color: string }> = {
  no_significant_change: { label: "NO SIGNIFICANT CHANGE", color: "text-up" },
  slightly_changed: { label: "SLIGHTLY CHANGED", color: "text-gray-300" },
  significantly_changed: { label: "SIGNIFICANTLY CHANGED", color: "text-yellow-400" },
  completely_changed: { label: "COMPLETELY CHANGED", color: "text-down" },
};

const DIRECTION_COLOR: Record<string, string> = {
  improved: "text-up",
  weakened: "text-down",
  no_effect: "text-gray-400",
  uncertain: "text-yellow-400",
};

/**
 * "Research Again" + Analysis History (Step 19). Deliberately NOT
 * continuous or automatic — the user must explicitly click "Research
 * Again" to trigger anything, per spec ("do NOT build continuous
 * background monitoring... only retrieve current information when the
 * user explicitly clicks Research Again"). Viewing existing history and
 * comparisons is always free; only generating a brand-new analysis costs
 * anything, and that's the exact same real Final Report flow already
 * built (via the shared `useFinalReportGeneration` hook) — this panel
 * adds no new analysis logic of its own, only saving and comparison.
 */
export function AnalysisHistoryPanel({ ticker }: { ticker: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [viewState, setViewState] = useState<ViewState>({ open: false });
  const { state: genState, runReport } = useFinalReportGeneration(ticker);

  async function loadHistory() {
    setLoadState({ status: "loading" });
    try {
      const res = await fetch(`/api/analysis-history/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setLoadState({ status: "error", message: body.error?.message ?? "Failed to load history." });
        return;
      }
      setLoadState({ status: "success", data: body as AnalysisHistoryResult });
    } catch {
      setLoadState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  async function researchAgain() {
    await runReport();
    // Refresh history after a successful run so the new version and
    // updated comparison show up immediately -- saving already happened
    // server-side as part of the assemble step.
    await loadHistory();
  }

  async function viewReport(id: string) {
    setViewState({ open: true, status: "loading" });
    try {
      const res = await fetch(`/api/analysis-history/report/${id}`);
      const body = await res.json();
      if (!res.ok) {
        setViewState({ open: true, status: "error", message: body.error?.message ?? "Failed to load this report." });
        return;
      }
      setViewState({ open: true, status: "success", data: body as SavedAnalysisWithReport });
    } catch {
      setViewState({ open: true, status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Analysis History</h2>
        <div className="flex gap-2">
          <button
            onClick={loadHistory}
            disabled={loadState.status === "loading"}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-accent disabled:opacity-50"
          >
            {loadState.status === "loading" ? "Loading…" : "View History"}
          </button>
          <button
            onClick={researchAgain}
            disabled={genState.status === "loading"}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {genState.status === "loading" ? "Researching…" : "Research Again"}
          </button>
        </div>
      </div>

      {loadState.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Every completed Final Report is saved permanently. Click &quot;Research Again&quot; to run a
          brand-new analysis with current data and see exactly what changed since last time — nothing
          updates automatically or in the background.
        </p>
      )}

      {genState.status === "loading" && (
        <div className="mt-3">
          <StepProgress currentStepIndex={genState.stepIndex} failedStepIndex={null} />
        </div>
      )}
      {genState.status === "error" && (
        <div className="mt-3">
          <StepProgress currentStepIndex={genState.failedStepIndex} failedStepIndex={genState.failedStepIndex} />
          <p className="mt-2 text-sm text-red-400">{genState.message}</p>
        </div>
      )}

      {loadState.status === "error" && <p className="mt-3 text-sm text-red-400">{loadState.message}</p>}
      {loadState.status === "success" && (
        <HistoryView data={loadState.data} onViewReport={viewReport} />
      )}

      {viewState.open && <ReportModal state={viewState} onClose={() => setViewState({ open: false })} />}
    </section>
  );
}

function HistoryView({
  data,
  onViewReport,
}: {
  data: AnalysisHistoryResult;
  onViewReport: (id: string) => void;
}) {
  if (data.analyses.length === 0) {
    return (
      <p className="mt-3 text-xs text-gray-500">
        No saved analyses yet for {data.ticker} — click &quot;Research Again&quot; to create the first one.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {data.latestComparison && <ComparisonView comparison={data.latestComparison} />}

      <div>
        <h3 className="mb-2 text-xs font-semibold text-gray-200">{data.ticker} Analysis History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-3 py-1.5">Date</th>
                <th className="px-2 py-1.5">Rating</th>
                <th className="px-2 py-1.5 text-right">Expected Price</th>
                <th className="px-2 py-1.5 text-right">Confidence</th>
                <th className="px-2 py-1.5 text-right">Stock Price</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.analyses.map((a) => (
                <tr key={a.id} className="border-t border-border/50">
                  <td className="py-1.5 pr-3">{new Date(a.analysisDate).toLocaleDateString()}</td>
                  <td className={`px-2 py-1.5 font-medium ${RATING_LABEL[a.rating].color}`}>{RATING_LABEL[a.rating].label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">${a.expectedPrice}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a.confidenceScore}/100</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">${a.priceAtAnalysis.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => onViewReport(a.id)} className="text-accent hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.analyses.length >= 2 && <Timeline analyses={data.analyses} />}
    </div>
  );
}

function ComparisonView({ comparison }: { comparison: ComparisonResult }) {
  const thesisStyle = THESIS_CHANGE_LABEL[comparison.thesisChangeLevel];

  return (
    <div className="rounded-lg border border-accent/40 bg-bg/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Since Your Last Analysis</h3>

      <div className="mt-3 flex flex-wrap gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Previous Rating</div>
          <div className={`text-sm font-semibold ${RATING_LABEL[comparison.previous.rating].color}`}>
            {RATING_LABEL[comparison.previous.rating].label}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current Rating</div>
          <div className={`text-sm font-semibold ${RATING_LABEL[comparison.current.rating].color}`}>
            {RATING_LABEL[comparison.current.rating].label}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Previous Expected Price</div>
          <div className="text-sm font-semibold tabular-nums text-gray-200">${comparison.previous.expectedPrice}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current Expected Price</div>
          <div className="text-sm font-semibold tabular-nums text-gray-200">${comparison.current.expectedPrice}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Confidence</div>
          <div className="text-sm font-semibold tabular-nums text-gray-200">
            {comparison.previous.confidenceScore} → {comparison.current.confidenceScore}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Did The Investment Thesis Change? </span>
        <span className={`text-xs font-bold ${thesisStyle.color}`}>{thesisStyle.label}</span>
        <p className="mt-1 text-xs text-gray-400">{comparison.thesisChangeExplanation}</p>
      </div>

      <div className="mt-3">
        <h4 className="mb-1 text-xs font-semibold text-gray-200">Does Our Rating Change?</h4>
        <p className="text-xs text-gray-400">{comparison.ratingChangeExplanation}</p>
      </div>

      <div className="mt-3">
        <h4 className="mb-1.5 text-xs font-semibold text-gray-200">What Changed Since Your Last Analysis?</h4>
        <div className="flex flex-col gap-1.5">
          {comparison.whatChanged.map((c, i) => (
            <div key={i} className="text-xs">
              <span className={`font-medium ${DIRECTION_COLOR[c.direction]}`}>{c.whatChanged}</span>
              <span className="text-gray-500"> — {c.whyItMatters}</span>
            </div>
          ))}
        </div>
      </div>

      {(comparison.priceRelatedChanges.length > 0 || comparison.businessRelatedChanges.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-medium text-gray-400">What Changed Because Of The Stock Price</h4>
            {comparison.priceRelatedChanges.length === 0 ? (
              <p className="text-xs text-gray-600">None identified.</p>
            ) : (
              <ul className="space-y-0.5 text-xs text-gray-300">
                {comparison.priceRelatedChanges.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 text-xs font-medium text-gray-400">What Changed Because Of The Business</h4>
            {comparison.businessRelatedChanges.length === 0 ? (
              <p className="text-xs text-gray-600">None identified.</p>
            ) : (
              <ul className="space-y-0.5 text-xs text-gray-300">
                {comparison.businessRelatedChanges.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FactorList title="What Improved" items={comparison.whatImproved} color="text-up" />
        <FactorList title="What Got Worse" items={comparison.whatGotWorse} color="text-down" />
        <FactorList title="What Stayed The Same" items={comparison.whatStayedTheSame} color="text-gray-300" />
      </div>

      <p className="mt-3 text-xs text-gray-300">{comparison.whyOpinionChanged}</p>

      <div className="mt-2 rounded-md border border-border bg-panel/60 p-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Bottom Line: </span>
        <span className="text-xs text-gray-200">{comparison.finalBottomLine}</span>
      </div>
    </div>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <h4 className={`mb-1 text-[11px] font-medium ${color}`}>{title}</h4>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-600">None identified.</p>
      ) : (
        <ul className="space-y-0.5 text-[11px] text-gray-300">
          {items.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Timeline({ analyses }: { analyses: SavedAnalysisRecord[] }) {
  // Oldest first for a natural left-to-right / top-to-bottom timeline.
  const chronological = [...analyses].reverse();
  const byMonth = new Map<string, SavedAnalysisRecord[]>();
  for (const a of chronological) {
    const key = new Date(a.analysisDate).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    byMonth.set(key, [...(byMonth.get(key) ?? []), a]);
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-gray-200">Timeline</h3>
      <div className="flex flex-col gap-2">
        {Array.from(byMonth.entries()).map(([month, monthAnalyses]) => (
          <div key={month} className="text-xs">
            <div className="font-semibold uppercase tracking-wide text-gray-400">{month}</div>
            {monthAnalyses.map((a) => (
              <div key={a.id} className="ml-2 text-gray-500">
                → {RATING_LABEL[a.rating].label} · ${a.expectedPrice} · {a.confidenceScore}/100 confidence
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportModal({ state, onClose }: { state: Extract<ViewState, { open: true }>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Historical Report</h3>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300">
            Close
          </button>
        </div>

        {state.status === "loading" && <p className="mt-3 text-xs text-gray-500">Loading…</p>}
        {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
        {state.status === "success" && (
          <div className="mt-3 flex flex-col gap-3 text-xs text-gray-300">
            <p className="text-gray-500">
              As it was on {new Date(state.data.analysisDate).toLocaleString()} — shown exactly as originally
              generated, never updated with newer information.
            </p>
            <div className="rounded-md border border-border bg-bg/40 p-3">
              <div className={`text-sm font-bold ${RATING_LABEL[state.data.rating].color}`}>
                {RATING_LABEL[state.data.rating].label}
              </div>
              <div className="mt-1">
                Price then: ${state.data.priceAtAnalysis.toFixed(2)} · Expected: ${state.data.expectedPrice} ·
                Confidence: {state.data.confidenceScore}/100
              </div>
            </div>
            <p>{state.data.bottomLine}</p>
            <div>
              <h4 className="mb-1 font-medium text-gray-200">Committee Conclusion</h4>
              <p className="text-gray-400">{state.data.committeeConclusion}</p>
            </div>
            <div>
              <h4 className="mb-1 font-medium text-gray-200">Devil&apos;s Advocate</h4>
              <p className="text-gray-400">{state.data.devilsAdvocateConclusion}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
