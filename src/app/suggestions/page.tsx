"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TrendResetEvidenceNote } from "@/components/TrendResetEvidenceNote";
import type { ScanSummary } from "@/server/suggestions";
import type { ScanRow } from "@/lib/trend-reset-scan";

type RunState =
  | { status: "idle" }
  | { status: "running"; batch: number; total: number }
  | { status: "error"; message: string };

function money(n: number): string {
  return n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;
}
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Request failed (${res.status})`);
  return data;
}

/**
 * Suggestions: the S&P 500 checked against the Trend Reset rules.
 *
 * Code only -- the scan is arithmetic over price bars and makes no AI
 * call. It runs in small batches so no single request is slow, and the
 * page drives the batches one after another, showing progress.
 */
export default function SuggestionsPage() {
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [showClose, setShowClose] = useState(false);

  const loadWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const data = (await res.json()) as { items?: { ticker: string }[] };
      setWatchlist(new Set((data.items ?? []).map((i) => i.ticker)));
    } catch {
      /* the page still works without it */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/suggestions");
        const data = (await res.json()) as { scan: ScanSummary | null };
        setScan(data.scan);
      } finally {
        setLoading(false);
      }
    })();
    void loadWatchlist();
  }, [loadWatchlist]);

  async function runScan() {
    setAddMessage(null);
    try {
      const started = await postJson<{ id: string; totalBatches: number }>("/api/suggestions/scan", {});
      let latest: ScanSummary | null = null;
      for (let b = 0; b < started.totalBatches; b++) {
        setRun({ status: "running", batch: b + 1, total: started.totalBatches });
        const r = await postJson<{ scan: ScanSummary }>("/api/suggestions/scan", { scanId: started.id, batch: b });
        latest = r.scan;
      }
      setScan(latest);
      setRun({ status: "idle" });
    } catch (err) {
      setRun({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function addToWatchlist(ticker: string) {
    setAddMessage(null);
    try {
      await postJson("/api/watchlist", { ticker, notes: "Added from Trend Reset suggestions" });
      setWatchlist((s) => new Set(s).add(ticker));
    } catch (err) {
      setAddMessage(`${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const qualifying = scan?.rows.filter((r) => r.qualifies) ?? [];
  const closeCalls = scan?.rows.filter((r) => !r.qualifies) ?? [];
  const running = run.status === "running";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
          <div className="flex gap-4">
            <Link href="/watchlist" className="text-xs text-gray-500 hover:text-gray-300">
              Watchlist →
            </Link>
            <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
              ← Home
            </Link>
          </div>
        </div>
        <p className="text-sm text-gray-400">
          S&amp;P 500 stocks that meet all four Trend Reset conditions as of the last completed trading day. The scan
          is pure arithmetic over prices — no AI, no cost.
        </p>
      </header>

      <TrendResetEvidenceNote />

      <section className="flex flex-wrap items-center gap-3">
        <button
          onClick={runScan}
          disabled={running}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {running ? `Scanning… batch ${run.batch} of ${run.total}` : "Scan the S&P 500"}
        </button>
        <span className="text-xs text-gray-500">About 30–60 seconds. Prices update once a day, after the close.</span>
      </section>

      {run.status === "error" && (
        <p className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">
          The scan stopped: {run.message}
        </p>
      )}
      {addMessage && <p className="text-xs text-down">{addMessage}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !scan ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-gray-500">
          No scan yet. Click “Scan the S&amp;P 500”.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Scanned {new Date(scan.completedAt ?? scan.startedAt).toLocaleString()} · prices as of{" "}
            {scan.asOfDate ?? "—"} ·{" "}
            <span className={qualifying.length ? "text-up" : ""}>{qualifying.length} meet all four</span> ·{" "}
            {closeCalls.length} meet three · {scan.evaluated} of {scan.universeSize} evaluated
            {scan.skipped.length > 0 && ` · ${scan.skipped.length} could not be checked`}
          </p>

          {qualifying.length === 0 ? (
            <p className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-gray-500">
              No S&amp;P 500 stock meets all four conditions right now. That is normal — the setup is uncommon.
            </p>
          ) : (
            <SuggestionTable rows={qualifying} watchlist={watchlist} onAdd={addToWatchlist} />
          )}

          {closeCalls.length > 0 && (
            <section className="flex flex-col gap-2">
              <button
                onClick={() => setShowClose((v) => !v)}
                className="self-start text-xs text-gray-400 underline underline-offset-2"
              >
                {showClose ? "Hide" : "Show"} {closeCalls.length} close calls (three of four conditions)
              </button>
              {showClose && <SuggestionTable rows={closeCalls} watchlist={watchlist} onAdd={addToWatchlist} showMissing />}
            </section>
          )}

          {scan.skipped.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Stocks that could not be checked</summary>
              <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {scan.skipped.map((s) => (
                  <li key={s.ticker}>
                    <span className="font-medium text-gray-400">{s.ticker}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="text-xs text-gray-500">
            The S&amp;P 500 list is a fixed snapshot stored in the app, so recent index changes may be missing.
          </p>
        </>
      )}
    </main>
  );
}

function SuggestionTable({
  rows,
  watchlist,
  onAdd,
  showMissing = false,
}: {
  rows: ScanRow[];
  watchlist: Set<string>;
  onAdd: (ticker: string) => void;
  showMissing?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-panel">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">Stock</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">vs 200-day avg</th>
            <th className="px-3 py-2 text-right font-medium">63-day change now</th>
            <th className="px-3 py-2 text-right font-medium">Peak 63-day change</th>
            {showMissing && <th className="px-3 py-2 font-medium">Missing</th>}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-2">
                <Link href={`/stock/${r.ticker}`} className="font-semibold hover:text-accent">
                  {r.ticker}
                </Link>
              </td>
              <td className="px-3 py-2 text-right">{money(r.price)}</td>
              <td className={`px-3 py-2 text-right ${r.pctAboveSma >= 0 ? "text-up" : "text-down"}`}>
                {pct(r.pctAboveSma)}
              </td>
              <td className="px-3 py-2 text-right">{pct(r.roc63Pct)}</td>
              <td className="px-3 py-2 text-right">{pct(r.maxRoc63PriorPct)}</td>
              {showMissing && (
                <td className="px-3 py-2 text-xs text-gray-400">
                  {r.conditions.filter((c) => !c.passed).map((c) => c.detail).join("; ")}
                </td>
              )}
              <td className="px-3 py-2 text-right">
                {watchlist.has(r.ticker) ? (
                  <span className="text-xs text-gray-500">On watchlist</span>
                ) : (
                  <button
                    onClick={() => onAdd(r.ticker)}
                    className="rounded border border-border px-2 py-1 text-xs text-gray-300 hover:border-accent hover:text-accent"
                  >
                    Add to watchlist
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
