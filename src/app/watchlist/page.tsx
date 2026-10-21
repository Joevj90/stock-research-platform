"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TrendResetEvidenceNote as EvidenceNote } from "@/components/TrendResetEvidenceNote";
import type { WatchlistCheckResult, WatchlistCheckRow, WatchlistEntry } from "@/server/watchlist/service";

const MAX_WATCHLIST_SIZE = 25;

type CheckState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; data: WatchlistCheckResult };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function money(n: number): string {
  return n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
}

/**
 * The watchlist: stocks the user is tracking, checked against the Trend
 * Reset rules by code alone.
 *
 * Two separate actions, deliberately not combined. "Check watchlist"
 * runs arithmetic over price data for every stock at once and costs
 * nothing but a cached market-data request each. "Run full AI analysis"
 * is per-stock, triggered one at a time, and is the only thing here
 * that spends money. Putting an AI call behind the bulk button would
 * make an ordinary click expensive, so the bulk button cannot reach it.
 */
export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const json = await res.json();
      if (res.ok) setItems(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: tickerInput, notes: notesInput }),
    });
    const json = await res.json();
    if (!res.ok) {
      setAddError(json?.error?.message ?? "Could not add that stock.");
      return;
    }
    setTickerInput("");
    setNotesInput("");
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    await load();
    // A stale check table would still show the removed stock, so clear it.
    setCheck({ status: "idle" });
  }

  async function runCheck() {
    setCheck({ status: "running" });
    try {
      const res = await fetch("/api/watchlist/check", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setCheck({ status: "error", message: json?.error?.message ?? "The check failed." });
        return;
      }
      setCheck({ status: "done", data: json });
    } catch (err) {
      setCheck({ status: "error", message: err instanceof Error ? err.message : "The check failed." });
    }
  }

  const rowsByTicker = new Map<string, WatchlistCheckRow>();
  if (check.status === "done") for (const r of check.data.rows) rowsByTicker.set(r.ticker, r);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
            ← Home
          </Link>
        </div>
        <p className="text-sm text-gray-400">
          Stocks you&apos;re tracking, checked against the Trend Reset rules. The check is pure arithmetic — no AI, no
          cost.
        </p>
      </header>

      <EvidenceNote />

      <section className="rounded-lg border border-border bg-panel p-4">
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">Ticker</span>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-32 rounded border border-border bg-bg px-2 py-1.5 text-sm uppercase outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-gray-400">Note (optional)</span>
            <input
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="Why you're watching it"
              className="w-full rounded border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!tickerInput.trim()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Add
          </button>
        </form>
        {addError && <p className="mt-2 text-xs text-down">{addError}</p>}
        <p className="mt-2 text-xs text-gray-500">
          {items.length} of {MAX_WATCHLIST_SIZE} slots used. For a wider search, see{" "}
          <Link href="/suggestions" className="underline underline-offset-2 hover:text-gray-300">
            Suggestions
          </Link>
          , which checks the whole S&amp;P 500.
        </p>
      </section>

      <section className="flex items-center gap-3">
        <button
          onClick={runCheck}
          disabled={check.status === "running" || items.length === 0}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {check.status === "running" ? "Checking…" : "Check watchlist"}
        </button>
        <span className="text-xs text-gray-500">
          Code only — runs the four conditions over every stock. Makes no AI calls.
        </span>
      </section>

      {check.status === "error" && (
        <p className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">{check.message}</p>
      )}

      {check.status === "done" && (
        <p className="text-xs text-gray-500">
          Checked {formatDate(check.data.checkedAt)} at{" "}
          {new Date(check.data.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ·{" "}
          <span className={check.data.qualifyingCount > 0 ? "text-up" : ""}>
            {check.data.qualifyingCount} of {check.data.rows.length} meet all four conditions
          </span>{" "}
          · used up to {check.data.marketDataRequestsUsed} market-data requests
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-gray-500">
          Nothing on the watchlist yet. Add a ticker above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(check.status === "done" ? check.data.rows.map((r) => r.ticker) : items.map((i) => i.ticker)).map(
            (ticker) => {
              const item = items.find((i) => i.ticker === ticker);
              if (!item) return null;
              return (
                <WatchlistCard key={item.id} item={item} row={rowsByTicker.get(item.ticker)} onRemove={remove} />
              );
            }
          )}
        </ul>
      )}
    </main>
  );
}

/**
 * The backtest's own conclusion, shown above the list rather than
 * buried. A screen that lists qualifying stocks without it would read
 * as a recommendation, and the evidence does not support that reading.
 */
function WatchlistCard({
  item,
  row,
  onRemove,
}: {
  item: WatchlistEntry;
  row: WatchlistCheckRow | undefined;
  onRemove: (id: string) => void;
}) {
  const evaluation = row?.evaluation;
  const passedCount = evaluation?.conditions.filter((c) => c.passed).length ?? 0;

  return (
    <li className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Link href={`/stock/${item.ticker}`} className="text-lg font-semibold hover:text-accent">
              {item.ticker}
            </Link>
            {evaluation && !evaluation.insufficientData && (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  evaluation.qualifies ? "bg-up/20 text-up" : "bg-border text-gray-400"
                }`}
              >
                {evaluation.qualifies ? "All 4 conditions met" : `${passedCount} of 4`}
              </span>
            )}
          </div>
          {item.companyName && <span className="text-xs text-gray-500">{item.companyName}</span>}
          {item.notes && <span className="text-xs text-gray-400">{item.notes}</span>}
        </div>

        <div className="flex items-center gap-3">
          {evaluation?.currentPrice !== null && evaluation?.currentPrice !== undefined && (
            <div className="text-right">
              <div className="text-sm font-medium">{money(evaluation.currentPrice)}</div>
              {evaluation.sma200 !== null && (
                <div className="text-xs text-gray-500">
                  200-day avg {money(evaluation.sma200)}
                  {evaluation.pctAboveSma !== null && (
                    <span className={evaluation.pctAboveSma >= 0 ? " text-up" : " text-down"}>
                      {" "}
                      ({evaluation.pctAboveSma >= 0 ? "+" : ""}
                      {evaluation.pctAboveSma}%)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <Link
            href={`/stock/${item.ticker}`}
            className="rounded border border-border px-2.5 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent"
          >
            Run full AI analysis →
          </Link>
          <button
            onClick={() => onRemove(item.id)}
            className="rounded border border-border px-2 py-1.5 text-xs text-gray-500 hover:border-down hover:text-down"
            aria-label={`Remove ${item.ticker}`}
          >
            Remove
          </button>
        </div>
      </div>

      {row?.error && <p className="mt-3 text-xs text-down">{row.error}</p>}

      {evaluation && !evaluation.insufficientData && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {evaluation.conditions.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-xs">
              <span className={c.passed ? "text-up" : "text-gray-600"}>{c.passed ? "✓" : "✗"}</span>
              <span className="flex-1 text-gray-400">{c.label}</span>
              <span className={c.passed ? "text-gray-300" : "text-gray-500"}>{c.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {row?.latestForecast && (
        <div className="mt-3 border-t border-border pt-3 text-xs text-gray-400">
          <span className="text-gray-500">Last saved AI forecast</span> ({formatDate(row.latestForecast.predictionDate)}
          , {row.latestForecast.horizon.replace("_", " ")}):{" "}
          <span className={row.latestForecast.expectedReturnPct >= 0 ? "text-up" : "text-down"}>
            {row.latestForecast.expectedReturnPct >= 0 ? "+" : ""}
            {row.latestForecast.expectedReturnPct}%
          </span>{" "}
          · {row.latestForecast.aiRating} · confidence {row.latestForecast.confidenceScore}
        </div>
      )}
    </li>
  );
}
