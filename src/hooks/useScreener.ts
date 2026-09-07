"use client";

import { useState } from "react";
import { SP500_TICKERS } from "@/data/sp500-tickers";
import type { ValuationGapCandidate, ValuationScanChunkResult, ScreenerHit } from "@/lib/screener-types";
import type { ForecastResult } from "@/lib/forecast-types";

// Phase 1 (no AI, cheap): chunk the ~500-ticker universe so each request
// to /api/screener/scan comfortably finishes within that route's time
// budget, with a few chunks in flight at once to keep the overall scan
// from taking too long serially.
const CHUNK_SIZE = 40;
const CONCURRENT_CHUNKS = 3;

// Only this many of the highest-ranked Phase 1 candidates go through the
// real, AI-backed Forecasting Agent in Phase 2 -- this is what keeps a
// full scan's AI cost proportional to ~20-30 "Analyze Stock" runs
// instead of ~500.
const SHORTLIST_SIZE = 25;
const CONCURRENT_FORECASTS = 4;

const MIN_RETURN_PCT = 10; // the ">10% in the next month" threshold

export type ScreenerState =
  | { status: "idle" }
  | { status: "scanning_valuation"; scanned: number; total: number }
  | { status: "scanning_forecasts"; completed: number; total: number }
  | { status: "error"; message: string }
  | {
      status: "success";
      hits: ScreenerHit[]; // cleared the >10% / 1-month bar
      shortlist: ScreenerHit[]; // every ticker Phase 2 actually ran on, for context
      scannedCount: number;
      failedTickers: string[];
    };

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Runs `items` through `worker` with at most `limit` in flight at once
 * -- avoids both a fully sequential scan (slow: ~500 tickers one at a
 * time) and a fully unbounded one (risks bursting past FMP/Anthropic
 * rate limits). `onProgress` fires after each item completes. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onProgress: (doneCount: number) => void
): Promise<void> {
  let nextIndex = 0;
  let doneCount = 0;

  async function runOne(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      await worker(items[i]!);
      doneCount++;
      onProgress(doneCount);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runOne()));
}

/**
 * Two-phase S&P 500 valuation/forecast screener, driven entirely from
 * the browser (same "client orchestrates short server steps" pattern
 * the Final Report chain uses, for the same reason: no single request
 * can safely run for as long as a full scan would take).
 *
 * Phase 1 scans the whole S&P 500 with no AI cost (see
 * /api/screener/scan) and ranks every ticker by real DCF implied
 * upside. Phase 2 runs the REAL, unmodified Forecasting Agent (the same
 * one "Analyze Stock" uses, via the existing /api/forecast/[ticker]
 * route) on only the top-ranked shortlist, and reads each one's real
 * 1-month expected return. Note: since that route already records every
 * forecast for Prediction Tracking (Step 18), running a scan will add a
 * batch of new predictions there too -- expected, not a bug.
 */
export function useScreener() {
  const [state, setState] = useState<ScreenerState>({ status: "idle" });

  async function runScreen() {
    setState({ status: "scanning_valuation", scanned: 0, total: SP500_TICKERS.length });

    const chunks = chunkArray(SP500_TICKERS, CHUNK_SIZE);
    const allCandidates: ValuationGapCandidate[] = [];
    const allFailed: string[] = [];

    try {
      await runPool(
        chunks,
        CONCURRENT_CHUNKS,
        async (tickerChunk) => {
          const res = await fetch("/api/screener/scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tickers: tickerChunk }),
          });
          if (!res.ok) {
            allFailed.push(...tickerChunk);
            return;
          }
          const data = (await res.json()) as ValuationScanChunkResult;
          allCandidates.push(...data.candidates);
          allFailed.push(...data.failedTickers);
        },
        (doneChunks) => {
          setState({
            status: "scanning_valuation",
            scanned: Math.min(SP500_TICKERS.length, doneChunks * CHUNK_SIZE),
            total: SP500_TICKERS.length,
          });
        }
      );
    } catch {
      setState({ status: "error", message: "The valuation scan lost connection partway through. Try again." });
      return;
    }

    // Rank by real DCF implied upside (most undervalued first); only
    // the top SHORTLIST_SIZE proceed to the AI-backed Phase 2.
    const ranked = allCandidates
      .filter((c): c is ValuationGapCandidate & { impliedUpsidePct: number } => c.impliedUpsidePct !== null)
      .sort((a, b) => b.impliedUpsidePct - a.impliedUpsidePct)
      .slice(0, SHORTLIST_SIZE);

    if (ranked.length === 0) {
      setState({ status: "success", hits: [], shortlist: [], scannedCount: allCandidates.length, failedTickers: allFailed });
      return;
    }

    setState({ status: "scanning_forecasts", completed: 0, total: ranked.length });

    const shortlistResults: ScreenerHit[] = [];
    try {
      await runPool(
        ranked,
        CONCURRENT_FORECASTS,
        async (candidate) => {
          const res = await fetch(`/api/forecast/${candidate.ticker}`);
          if (!res.ok) return; // skipped, not fabricated -- same as a Phase 1 fetch failure
          const forecast = (await res.json()) as ForecastResult;
          const oneMonth = forecast.interpretation.horizons.find((h) => h.horizon === "1_month");
          if (!oneMonth) return;

          shortlistResults.push({
            ticker: forecast.ticker,
            companyName: forecast.companyName,
            currentPrice: forecast.currentPrice,
            expectedPrice: oneMonth.expectedPrice,
            expectedReturnPct: oneMonth.expectedReturnPct,
            confidenceScore: forecast.interpretation.confidenceScore,
            dataSupportsThisHorizon: oneMonth.dataSupportsThisHorizon,
            limitationNote: oneMonth.limitationNote,
            impliedUpsidePct: candidate.impliedUpsidePct,
          });
        },
        (doneCount) => {
          setState({ status: "scanning_forecasts", completed: doneCount, total: ranked.length });
        }
      );
    } catch {
      setState({ status: "error", message: "The forecast scan lost connection partway through. Try again." });
      return;
    }

    const sortedShortlist = [...shortlistResults].sort((a, b) => b.expectedReturnPct - a.expectedReturnPct);
    const hits = sortedShortlist.filter((r) => r.dataSupportsThisHorizon && r.expectedReturnPct > MIN_RETURN_PCT);

    setState({
      status: "success",
      hits,
      shortlist: sortedShortlist,
      scannedCount: allCandidates.length,
      failedTickers: allFailed,
    });
  }

  return { state, runScreen };
}
