/**
 * Trade-level statistics for the breakout backtest.
 *
 * Portfolio-level numbers (total and annualized return, maximum drawdown,
 * turnover, comparison with SPY) need every symbol's prices at once and
 * come with the universe run in Phase 3. This file only summarizes lists
 * of trades.
 *
 * Trades still open at the end of the data ("open") are excluded from
 * the closed-trade statistics; their count is reported separately.
 */

import type { Trade } from "./engine";

export interface TradeStats {
  trades: number;
  closedTrades: number;
  openTrades: number;
  /** Closed trades that ended because the stock stopped trading. */
  delistedTrades: number;
  winRate: number;
  avgReturn: number;
  medianReturn: number;
  avgWin: number;
  avgLoss: number;
  /** Sum of winning returns / |sum of losing returns|. */
  profitFactor: number;
  avgHoldDays: number;
  /** Product of (1 + return) over closed trades, minus 1. Only meaningful
   * for trades taken one after another in a single stock. */
  compounded: number;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function tradeStats(trades: Trade[]): TradeStats {
  const closed = trades.filter((t) => t.exitReason !== "open");
  const rets = closed.map((t) => t.returnPct);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const lossSum = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    trades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    delistedTrades: closed.filter((t) => t.exitReason === "delisted").length,
    winRate: closed.length ? wins.length / closed.length : NaN,
    avgReturn: mean(rets),
    medianReturn: median(rets),
    avgWin: mean(wins),
    avgLoss: mean(losses),
    profitFactor: lossSum > 0 ? wins.reduce((a, b) => a + b, 0) / lossSum : wins.length ? Infinity : NaN,
    avgHoldDays: mean(closed.map((t) => t.holdDays)),
    compounded: rets.reduce((acc, r) => acc * (1 + r), 1) - 1,
  };
}

/** Group trades by a key and summarize each group. */
export function statsBy<K extends string>(trades: Trade[], key: (t: Trade) => K): Record<K, TradeStats> {
  const groups = new Map<K, Trade[]>();
  for (const t of trades) {
    const k = key(t);
    const list = groups.get(k);
    if (list) list.push(t);
    else groups.set(k, [t]);
  }
  return Object.fromEntries([...groups].map(([k, ts]) => [k, tradeStats(ts)])) as Record<K, TradeStats>;
}
