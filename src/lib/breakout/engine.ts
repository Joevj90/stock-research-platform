/**
 * Trade simulator for the breakout backtest.
 *
 * One stock at a time, one position at a time, daily bars. Order of
 * events within a trading day i:
 *   1. A trailing exit scheduled yesterday fills at today's open.
 *   2. An entry scheduled yesterday fills at today's open -- unless the
 *      open is already at or below the initial stop, in which case the
 *      entry is skipped (you would not buy a stock that has already hit
 *      its stop).
 *   3. Intraday stop: if today's low reaches the stop, exit at the stop,
 *      or at the open if the stock gapped below it. Gaps are never filled
 *      at the stop price.
 *   4. At the close of the last trading day of a week: if the weekly
 *      close is below the 10-week average, schedule an exit for the next
 *      open.
 *   5. If flat: act on today's signals (entry at the next open, or start
 *      a 5-day confirmation watch for Setup A).
 *
 * Every fill pays slippage (by liquidity tier) plus a per-side cost.
 *
 * Positions still open when a stock's data stops early (delisting,
 * bankruptcy, takeover, ticker reuse) are closed per `delistMode`;
 * positions open at the end of the dataset are marked at the last close
 * and flagged "open" so they can be excluded from closed-trade stats.
 */

import type { BreakoutConfig, LiquidityTier } from "./config";
import { type DailySeries, type Segment, splitOnGaps, weeklyView } from "./series";
import { computeSignals, type IndexContext, type Signal, type SetupKind } from "./signals";

/** "R" = re-entry on a 10-week-MA reclaim (reentryMode "maReclaim"). */
export type TradeSetup = SetupKind | "R";
export type ExitReason = "stop" | "trailing" | "delisted" | "open";

export interface Trade {
  symbol: string;
  segmentIndex: number;
  setup: TradeSetup;
  signalDate: string;
  entryDate: string;
  /** Fill price including slippage (before the per-side cost). */
  entryPrice: number;
  stop: number;
  exitDate: string;
  exitPrice: number;
  exitReason: ExitReason;
  /** Net of slippage and costs, as a fraction (0.25 = +25%). */
  returnPct: number;
  holdDays: number;
  tier: LiquidityTier;
  selloffStrength: boolean | null;
  volumeRatio: number;
  baseDays?: number;
}

export interface SymbolResult {
  symbol: string;
  trades: Trade[];
  signalCount: number;
  /** Entries skipped because the stock opened at or below the stop. */
  skippedGapBelowStop: number;
  /** Setup A signals cancelled by the 5-day confirmation rule. */
  cancelledConfirmations: number;
  segments: number;
}

interface Position {
  entryIdx: number;
  entryFill: number;
  stop: number;
  setup: TradeSetup;
  signal: Pick<Signal, "date" | "tier" | "selloffStrength" | "volumeRatio" | "baseDays">;
}

interface PendingEntry {
  idx: number;
  setup: TradeSetup;
  stop: number;
  signal: Position["signal"];
}

const PRIORITY: SetupKind[] = ["A", "B", "C"];

export function simulateSegment(
  seg: Segment,
  cfg: BreakoutConfig,
  index: IndexContext | null,
): Omit<SymbolResult, "segments"> {
  const n = seg.dates.length;
  const { open, low, close } = seg;
  const signals = computeSignals(seg, cfg, index);
  const wv = weeklyView(seg, cfg.trailingWeeks);
  const trades: Trade[] = [];
  let signalCount = 0;
  let skippedGapBelowStop = 0;
  let cancelledConfirmations = 0;

  let pos: Position | null = null;
  let pendingEntry: PendingEntry | null = null;
  let pendingExitIdx: number | null = null;
  let confirm: { sig: Signal; until: number } | null = null;
  // maReclaim bookkeeping
  let lastTrailingExitWeek: number | null = null;
  let minLowSinceExit = Infinity;
  let prevWeekBelowMa = false;

  const tierOf = (p: Position) => p.signal.tier;

  const close_ = (p: Position, idx: number, rawPrice: number, reason: ExitReason) => {
    const slip = cfg.slippageBps[tierOf(p)] / 1e4;
    const cost = cfg.costBpsPerSide / 1e4;
    let exitFill: number;
    let ret: number;
    if (reason === "delisted" && cfg.delistMode === "zero") {
      exitFill = 0;
      ret = -1;
    } else {
      exitFill = rawPrice * (1 - slip);
      ret = (exitFill * (1 - cost)) / (p.entryFill * (1 + cost)) - 1;
    }
    trades.push({
      symbol: seg.symbol,
      segmentIndex: seg.segmentIndex,
      setup: p.setup,
      signalDate: p.signal.date,
      entryDate: seg.dates[p.entryIdx]!,
      entryPrice: p.entryFill,
      stop: p.stop,
      exitDate: seg.dates[idx]!,
      exitPrice: exitFill,
      exitReason: reason,
      returnPct: ret,
      holdDays: idx - p.entryIdx,
      tier: p.signal.tier,
      selloffStrength: p.signal.selloffStrength,
      volumeRatio: p.signal.volumeRatio,
      baseDays: p.signal.baseDays,
    });
  };

  for (let i = 0; i < n; i++) {
    signalCount += signals[i]!.length;

    // 1. Scheduled trailing exit at the open.
    if (pos && pendingExitIdx === i) {
      close_(pos, i, open[i]!, "trailing");
      pos = null;
      pendingExitIdx = null;
      lastTrailingExitWeek = wv.weekIndex[i]!;
      minLowSinceExit = Infinity;
    }

    // 2. Scheduled entry at the open.
    if (!pos && pendingEntry && pendingEntry.idx === i) {
      if (open[i]! <= pendingEntry.stop) {
        skippedGapBelowStop++;
      } else {
        const slip = cfg.slippageBps[pendingEntry.signal.tier] / 1e4;
        pos = {
          entryIdx: i,
          entryFill: open[i]! * (1 + slip),
          stop: pendingEntry.stop,
          setup: pendingEntry.setup,
          signal: pendingEntry.signal,
        };
        lastTrailingExitWeek = null;
      }
      pendingEntry = null;
    }

    // 3. Intraday stop (gap-through fills at the open).
    if (pos && low[i]! <= pos.stop) {
      close_(pos, i, Math.min(open[i]!, pos.stop), "stop");
      pos = null;
      pendingExitIdx = null;
    }

    if (!pos) minLowSinceExit = Math.min(minLowSinceExit, low[i]!);

    // 4. Weekly trailing exit check at the week's last close.
    const weekEnd = wv.isWeekEnd[i]!;
    const ma = wv.weeklySma[i]!;
    const belowMa = weekEnd && Number.isFinite(ma) && close[i]! < ma;
    if (pos && belowMa && i + 1 < n) pendingExitIdx = i + 1;

    // 5. New entries when flat.
    if (!pos && !pendingEntry && i + 1 < n) {
      if (confirm) {
        if (close[i]! < confirm.sig.pivot) {
          confirm = null;
          cancelledConfirmations++;
        } else if (i >= confirm.until) {
          pendingEntry = { idx: i + 1, setup: "A", stop: confirm.sig.stop, signal: confirm.sig };
          confirm = null;
        }
      }
      if (!confirm && !pendingEntry) {
        const sig = PRIORITY.map((k) => signals[i]!.find((x) => x.setup === k)).find(Boolean);
        if (sig) {
          if (sig.setup === "A" && cfg.entryMode === "confirm5") {
            confirm = { sig, until: i + cfg.confirmDays };
          } else {
            pendingEntry = { idx: i + 1, setup: sig.setup, stop: sig.stop, signal: sig };
          }
        }
      }
      if (
        !confirm &&
        !pendingEntry &&
        cfg.reentryMode === "maReclaim" &&
        lastTrailingExitWeek !== null &&
        weekEnd &&
        Number.isFinite(ma)
      ) {
        const weeksSince = wv.weekIndex[i]! - lastTrailingExitWeek;
        const reclaim = close[i]! > ma && prevWeekBelowMa && wv.weekLow[i]! > minLowSinceExit;
        if (weeksSince > cfg.reclaimMaxWeeks) {
          lastTrailingExitWeek = null;
        } else if (reclaim) {
          pendingEntry = {
            idx: i + 1,
            setup: "R",
            stop: minLowSinceExit,
            signal: { date: seg.dates[i]!, tier: lastTierFor(trades), selloffStrength: null, volumeRatio: 0 },
          };
        }
      }
    }
    if (weekEnd && Number.isFinite(ma)) prevWeekBelowMa = belowMa;
  }

  if (pos) {
    close_(pos, n - 1, close[n - 1]!, seg.endsAbruptly ? "delisted" : "open");
  }
  return { symbol: seg.symbol, trades, signalCount, skippedGapBelowStop, cancelledConfirmations };
}

function lastTierFor(trades: Trade[]): LiquidityTier {
  return trades.length ? trades[trades.length - 1]!.tier : "small";
}

/** Run one symbol's full history: split at long gaps, simulate each piece. */
export function runSymbol(
  series: DailySeries,
  cfg: BreakoutConfig,
  index: IndexContext | null,
  datasetEnd: string,
): SymbolResult {
  const segments = splitOnGaps(series, cfg.maxGapCalendarDays, datasetEnd, cfg.delistGraceDays);
  const result: SymbolResult = {
    symbol: series.symbol,
    trades: [],
    signalCount: 0,
    skippedGapBelowStop: 0,
    cancelledConfirmations: 0,
    segments: segments.length,
  };
  for (const seg of segments) {
    const r = simulateSegment(seg, cfg, index);
    result.trades.push(...r.trades);
    result.signalCount += r.signalCount;
    result.skippedGapBelowStop += r.skippedGapBelowStop;
    result.cancelledConfirmations += r.cancelledConfirmations;
  }
  return result;
}
