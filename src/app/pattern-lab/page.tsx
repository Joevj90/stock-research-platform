"use client";

import { useState } from "react";
import Link from "next/link";
import type { BacktestResult, PatternPerformance, PooledBacktestResult } from "@/lib/pattern-backtest";

type LabState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: BacktestResult & { interval: string; horizonDays: number; lookbackDays: number } }
  | { status: "pooled"; data: PooledBacktestResult & { skipped: string[]; horizonDays: number } };

/** A spread across sectors rather than ten tech names, so a single
 * sector's 90-day run can't masquerade as a pattern working. */
const DEFAULT_BATCH = "AAPL, MSFT, NVDA, JPM, XOM, JNJ, WMT, CAT, KO, T";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Pattern Lab: the measurement half of the short-term chart experiment.
 *
 * This page exists to answer one question before any AI is wired up --
 * do these chart patterns predict anything at all? It deliberately shows
 * edge over a naive baseline rather than raw hit rate, because a raw hit
 * rate in a rising market tells you nothing, and it marks any result
 * that isn't statistically distinguishable from chance so a promising
 * number on six samples can't be mistaken for a finding.
 */
export default function PatternLabPage() {
  const [ticker, setTicker] = useState("AAPL");
  const [horizonDays, setHorizonDays] = useState(1);
  const [state, setState] = useState<LabState>({ status: "idle" });
  const [batchTickers, setBatchTickers] = useState(DEFAULT_BATCH);

  async function run() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/pattern-backtest/${ticker}?horizonDays=${horizonDays}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setState({
          status: "error",
          message: body?.error?.message ?? "The backtest request failed.",
        });
        return;
      }
      setState({ status: "success", data: await res.json() });
    } catch {
      setState({ status: "error", message: "Lost connection while running the backtest." });
    }
  }

  async function runBatch() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/pattern-backtest-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tickers: batchTickers.split(",").map((t) => t.trim()).filter(Boolean),
          horizonDays,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setState({ status: "error", message: body?.error?.message ?? "The pooled backtest failed." });
        return;
      }
      setState({ status: "pooled", data: await res.json() });
    } catch {
      setState({ status: "error", message: "Lost connection while running the pooled backtest." });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
        ← Back to search
      </Link>

      <section className="rounded-xl border-2 border-accent/50 bg-panel p-6">
        <h1 className="text-base font-semibold text-gray-200">Pattern Lab (experiment)</h1>
        <p className="mt-1 text-xs text-gray-500">
          Replays chart patterns over real 5-minute bars from the last 90 days and measures whether they predicted
          anything. No AI is used here and no prediction is made — this only measures what already happened.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">Ticker</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-28 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-gray-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-gray-500">Horizon</span>
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-gray-100"
            >
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={run}
            disabled={state.status === "loading"}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {state.status === "loading" ? "Running…" : "Run backtest"}
          </button>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h2 className="text-xs font-semibold text-gray-200">Pooled run (recommended)</h2>
          <p className="mt-1 text-[11px] text-gray-500">
            Combines occurrences from several tickers into one test. This matters: ten separate tests let you pick
            the best-looking one, and with enough tries something always looks good by luck. One pooled test with a
            large sample avoids that.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[260px] flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Tickers (comma separated, max 10)</span>
              <input
                value={batchTickers}
                onChange={(e) => setBatchTickers(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-gray-100"
              />
            </label>
            <button
              onClick={runBatch}
              disabled={state.status === "loading"}
              className="rounded-md border border-accent px-4 py-2 text-xs font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
            >
              {state.status === "loading" ? "Running…" : "Run pooled backtest"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Ten tickers takes a few minutes — each one fetches 90 days of 5-minute bars.
          </p>
        </div>

        {state.status === "error" && <p className="mt-4 text-sm text-red-400">{state.message}</p>}

        {state.status === "success" && <Results data={state.data} />}

        {state.status === "pooled" && <PooledResults data={state.data} />}
      </section>
    </main>
  );
}

function Results({
  data,
}: {
  data: BacktestResult & { interval: string; horizonDays: number; lookbackDays: number };
}) {
  const meaningful = data.patterns.filter((p) => p.isStatisticallyMeaningful);

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Bars analyzed" value={data.totalBars.toLocaleString()} />
        <Stat label="Patterns found" value={String(data.patterns.length)} />
        <Stat label="Baseline: always up" value={pct(data.upRateAllBars)} />
        <Stat label="Baseline: trend continues" value={pct(data.trendContinuationHitRate)} />
      </div>

      <p className="text-xs text-gray-500">
        Over this sample, price rose across {pct(data.upRateAllBars)} of all {data.horizonDays}-day windows. That is
        what a pattern has to beat — being right {pct(data.upRateAllBars)} of the time means the chart added nothing.
        The Edge column is the only number that matters.
      </p>

      {data.patterns.length > 0 && <EdgeChart patterns={data.patterns} />}

      {data.patterns.length === 0 ? (
        <p className="text-sm text-gray-400">No patterns were detected in this sample.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="px-2 py-1.5 font-medium">Pattern</th>
                <th className="px-2 py-1.5 font-medium">N</th>
                <th className="px-2 py-1.5 font-medium">Hit rate</th>
                <th className="px-2 py-1.5 font-medium">Baseline</th>
                <th className="px-2 py-1.5 font-medium">Edge</th>
                <th className="px-2 py-1.5 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.patterns.map((p) => (
                <tr key={p.key} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <span className="font-medium text-gray-100">{p.name}</span>
                    <div className="text-[10px] text-gray-500">{p.direction}</div>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-400">{p.sampleSize}</td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-300">{pct(p.hitRate)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-gray-500">{pct(p.baselineHitRate)}</td>
                  <td
                    className={`px-2 py-1.5 tabular-nums font-semibold ${
                      p.edge > 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {p.edge >= 0 ? "+" : ""}
                    {pct(p.edge)}
                  </td>
                  <td className="px-2 py-1.5 text-[10px]">
                    {p.isStatisticallyMeaningful ? (
                      <span className="text-up">Beats chance</span>
                    ) : p.sampleSize < 30 ? (
                      <span className="text-gray-500">Too few samples</span>
                    ) : (
                      <span className="text-gray-500">Within noise</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg/40 p-3">
        <h2 className="text-xs font-semibold text-gray-200">What this means</h2>
        {meaningful.length === 0 ? (
          <p className="mt-1 text-xs text-gray-400">
            No pattern showed an edge distinguishable from chance on this sample. That is a real result, not a
            failure of the test — it is evidence against building a prediction feature on these patterns for{" "}
            {data.ticker}. Worth re-running on other tickers and horizons before concluding.
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
            {meaningful.length} pattern{meaningful.length > 1 ? "s" : ""} showed an edge beyond chance on this
            sample. That is promising but not proof: it is one ticker over one period, and testing many patterns
            makes an occasional false positive likely. Re-run across several tickers before trusting it.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Edge-versus-noise chart. Each pattern gets a bar showing its edge over
 * the naive baseline, drawn on top of a shaded band representing +/- two
 * standard errors for that pattern's sample size.
 *
 * The band is the whole point. A bar that stays inside its own grey band
 * has not demonstrated anything, however long it looks -- which is
 * exactly the mistake a plain bar chart of hit rates would invite. Small
 * samples produce wide bands, so a single lucky occurrence renders as a
 * long bar swallowed by an even longer band, and reads correctly at a
 * glance.
 */
function EdgeChart({ patterns }: { patterns: PatternPerformance[] }) {
  const rowHeight = 26;
  const height = patterns.length * rowHeight + 28;
  const width = 560;
  const midX = width / 2;

  // Scale to whichever is widest: the largest edge or the widest noise
  // band, so a band is never clipped and can't look narrower than it is.
  const maxExtent = Math.max(
    0.05,
    ...patterns.map((p) => Math.max(Math.abs(p.edge), 2 * p.standardError))
  );
  const scale = (midX - 70) / maxExtent;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Pattern edge versus noise">
        {patterns.map((p, i) => {
          const y = i * rowHeight + 8;
          const bandHalf = 2 * p.standardError * scale;
          const edgeWidth = Math.abs(p.edge) * scale;
          const edgeX = p.edge >= 0 ? midX : midX - edgeWidth;
          return (
            <g key={p.key}>
              <rect
                x={midX - bandHalf}
                y={y}
                width={bandHalf * 2}
                height={rowHeight - 10}
                fill="currentColor"
                className="text-gray-600"
                opacity={0.25}
              />
              <rect
                x={edgeX}
                y={y + 3}
                width={Math.max(edgeWidth, 1)}
                height={rowHeight - 16}
                className={p.isStatisticallyMeaningful ? "text-up" : "text-gray-400"}
                fill="currentColor"
              />
              <text x={4} y={y + 12} className="fill-gray-400" fontSize="9">
                {p.name} (n={p.sampleSize})
              </text>
            </g>
          );
        })}
        <line x1={midX} y1={0} x2={midX} y2={height - 20} stroke="currentColor" className="text-gray-500" strokeWidth={1} />
        <text x={midX + 4} y={height - 8} className="fill-gray-500" fontSize="9">
          baseline
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-gray-500">
        Bars show edge over the baseline. The grey band behind each is the range explainable by chance at that
        sample size — a bar that stays inside its band has shown nothing.
      </p>
    </div>
  );
}

function PooledResults({
  data,
}: {
  data: PooledBacktestResult & { skipped: string[]; horizonDays: number };
}) {
  const meaningful = data.patterns.filter((p) => p.isStatisticallyMeaningful);
  const largestSample = data.patterns.reduce((m, p) => Math.max(m, p.sampleSize), 0);

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tickers pooled" value={String(data.tickers.length)} />
        <Stat label="Bars analyzed" value={data.totalBars.toLocaleString()} />
        <Stat label="Largest sample" value={String(largestSample)} />
        <Stat label="Blended baseline" value={pct(data.blendedUpRate)} />
      </div>

      {data.skipped.length > 0 && (
        <p className="text-xs text-yellow-400">
          Skipped (no data): {data.skipped.join(", ")}
        </p>
      )}

      <p className="text-xs text-gray-500">
        Pooled across {data.tickers.join(", ")}. Each pattern&apos;s baseline is weighted by which tickers its
        occurrences actually came from, so a pattern that clustered in a strongly rising stock doesn&apos;t get
        credit for that stock&apos;s drift.
      </p>

      {data.patterns.length > 0 && <EdgeChart patterns={data.patterns} />}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="px-2 py-1.5 font-medium">Pattern</th>
              <th className="px-2 py-1.5 font-medium">N</th>
              <th className="px-2 py-1.5 font-medium">Hit rate</th>
              <th className="px-2 py-1.5 font-medium">Baseline</th>
              <th className="px-2 py-1.5 font-medium">Edge</th>
              <th className="px-2 py-1.5 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.patterns.map((p) => (
              <tr key={p.key} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <span className="font-medium text-gray-100">{p.name}</span>
                  <div className="text-[10px] text-gray-500">{p.direction}</div>
                </td>
                <td className="px-2 py-1.5 tabular-nums text-gray-400">{p.sampleSize}</td>
                <td className="px-2 py-1.5 tabular-nums text-gray-300">{pct(p.hitRate)}</td>
                <td className="px-2 py-1.5 tabular-nums text-gray-500">{pct(p.baselineHitRate)}</td>
                <td className={`px-2 py-1.5 tabular-nums font-semibold ${p.edge > 0 ? "text-up" : "text-down"}`}>
                  {p.edge >= 0 ? "+" : ""}
                  {pct(p.edge)}
                </td>
                <td className="px-2 py-1.5 text-[10px]">
                  {p.isStatisticallyMeaningful ? (
                    <span className="text-up">Beats chance</span>
                  ) : p.sampleSize < 30 ? (
                    <span className="text-gray-500">Too few samples</span>
                  ) : (
                    <span className="text-gray-500">Within noise</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-bg/40 p-3">
        <h2 className="text-xs font-semibold text-gray-200">What this means</h2>
        {meaningful.length === 0 ? (
          <p className="mt-1 text-xs text-gray-400">
            Across {data.tickers.length} tickers and {largestSample} occurrences at the largest sample, no pattern
            showed an edge distinguishable from chance. At this sample size that is a reasonably firm answer, not an
            inconclusive one: these patterns do not appear to carry predictive signal at a {data.horizonDays}-day
            horizon, and building a prediction feature on them would not be justified by this evidence.
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-400">
            {meaningful.length} pattern{meaningful.length > 1 ? "s" : ""} cleared chance across{" "}
            {data.tickers.length} tickers. That is a real result worth pursuing — though before trusting it, re-run
            on a different 90-day window, since one period can still flatter a pattern.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-200">{value}</div>
    </div>
  );
}
