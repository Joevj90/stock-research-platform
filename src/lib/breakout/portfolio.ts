/**
 * Portfolio simulation for the breakout backtest.
 *
 * Trade-level averages hide two things that decide whether a strategy is
 * usable: how much capital is actually working, and how deep the losing
 * stretches get. This replays a list of trades through a fixed number of
 * equal-sized slots, marking open positions to market every day, so the
 * result can be compared with simply holding SPY.
 *
 * Rules:
 *  - `maxPositions` slots. A new position gets 1/maxPositions of the
 *    previous day's total equity (or whatever cash is left, if less).
 *  - On a day with more entries than free slots, the highest `rank`
 *    wins (ties broken by symbol, so results are reproducible).
 *  - Exits on a day are settled before that day's entries, so freed
 *    cash can be reused the same day.
 *  - Trade returns already include slippage and costs. Cash earns nothing.
 */

export interface PortfolioTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  /** Net return of the whole trade (already includes costs). */
  returnPct: number;
  /** Entry fill price, to mark the position to market. */
  entryFill: number;
  /** The stock's close on a date during the trade, or undefined if it did
   * not trade that day (halts carry the last known value). */
  closeOn: (date: string) => number | undefined;
  rank: number;
}

export interface PortfolioResult {
  dates: string[];
  equity: number[];
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  /** Average share of equity invested. */
  avgExposure: number;
  tradesTaken: number;
  tradesSkipped: number;
}

export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    worst = Math.min(worst, e / peak - 1);
  }
  return worst;
}

export function cagr(startValue: number, endValue: number, startDate: string, endDate: string): number {
  const years = (Date.parse(endDate) - Date.parse(startDate)) / (365.25 * 86_400_000);
  return years > 0 ? (endValue / startValue) ** (1 / years) - 1 : NaN;
}

export function simulatePortfolio(calendar: string[], trades: PortfolioTrade[], maxPositions: number): PortfolioResult {
  const byEntry = new Map<string, PortfolioTrade[]>();
  for (const t of trades) {
    const list = byEntry.get(t.entryDate);
    if (list) list.push(t);
    else byEntry.set(t.entryDate, [t]);
  }
  for (const list of byEntry.values()) list.sort((a, b) => b.rank - a.rank || a.symbol.localeCompare(b.symbol));

  interface Open {
    t: PortfolioTrade;
    alloc: number;
    lastValue: number;
  }
  let cash = 1;
  let open: Open[] = [];
  const equity: number[] = [];
  let prevEquity = 1;
  let taken = 0;
  let skipped = 0;
  let exposureSum = 0;

  for (const d of calendar) {
    // Exits first.
    const still: Open[] = [];
    for (const p of open) {
      if (p.t.exitDate <= d) cash += p.alloc * (1 + p.t.returnPct);
      else still.push(p);
    }
    open = still;
    // Entries.
    for (const t of byEntry.get(d) ?? []) {
      if (open.length >= maxPositions || cash <= 1e-9) {
        skipped++;
        continue;
      }
      const alloc = Math.min(prevEquity / maxPositions, cash);
      cash -= alloc;
      taken++;
      if (t.exitDate <= d) {
        cash += alloc * (1 + t.returnPct); // in and out the same day
      } else {
        open.push({ t, alloc, lastValue: alloc });
      }
    }
    // Mark to market at the close.
    let invested = 0;
    for (const p of open) {
      const c = p.t.closeOn(d);
      if (c !== undefined) p.lastValue = p.alloc * (c / p.t.entryFill);
      invested += p.lastValue;
    }
    const eq = cash + invested;
    exposureSum += eq > 0 ? invested / eq : 0;
    equity.push(eq);
    prevEquity = eq;
  }
  const end = equity.length ? equity[equity.length - 1]! : 1;
  return {
    dates: calendar,
    equity,
    totalReturn: end - 1,
    cagr: calendar.length ? cagr(1, end, calendar[0]!, calendar[calendar.length - 1]!) : NaN,
    maxDrawdown: maxDrawdown(equity),
    avgExposure: calendar.length ? exposureSum / calendar.length : NaN,
    tradesTaken: taken,
    tradesSkipped: skipped,
  };
}
