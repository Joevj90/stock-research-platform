/**
 * Strategy vs random-entry control, the test that decides whether the
 * entry rules add anything.
 *
 * For every strategy trade, the control buys a randomly chosen OTHER
 * eligible stock of the same liquidity tier on the same day, with the
 * same stop distance and the same exit rules. So the only difference
 * between the two is which stock was bought. If the strategy's trades do
 * no better than those, the entry signals are not adding information --
 * the exits and the market's drift are doing all the work.
 *
 * Trades cluster in time (many breakouts fire in the same strong months),
 * so per-trade statistics overstate confidence. The t-statistic here is
 * clustered by entry month: each month contributes one number, the
 * average (strategy - control) difference of the trades entered in it.
 * The same method was used for the Trend Reset backtest.
 */

export interface PairedTrade {
  entryDate: string;
  strategyReturn: number;
  /** Returns of the control trades drawn for this strategy trade (one per
   * draw). Empty if no eligible control stock existed that day. */
  controlReturns: number[];
}

export interface EdgeResult {
  pairedTrades: number;
  strategyMean: number;
  controlMean: number;
  /** strategyMean - controlMean. */
  edgePerTrade: number;
  strategyMedian: number;
  controlMedian: number;
  strategyWinRate: number;
  controlWinRate: number;
  months: number;
  /** Mean of monthly average differences / its standard error. Roughly:
   * above 2 = unlikely to be chance; below 2 = not distinguishable. */
  clusteredT: number;
  /** Share of months where the strategy beat the control. */
  monthsAhead: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function edgeVsControl(pairs: PairedTrade[]): EdgeResult {
  const used = pairs.filter((p) => p.controlReturns.length > 0);
  const strat = used.map((p) => p.strategyReturn);
  const ctrlAll = used.flatMap((p) => p.controlReturns);
  const byMonth = new Map<string, number[]>();
  for (const p of used) {
    const m = p.entryDate.slice(0, 7);
    const diff = p.strategyReturn - mean(p.controlReturns);
    const list = byMonth.get(m);
    if (list) list.push(diff);
    else byMonth.set(m, [diff]);
  }
  const monthly = [...byMonth.values()].map(mean);
  const mu = mean(monthly);
  const sd =
    monthly.length > 1 ? Math.sqrt(monthly.reduce((a, x) => a + (x - mu) ** 2, 0) / (monthly.length - 1)) : NaN;
  return {
    pairedTrades: used.length,
    strategyMean: mean(strat),
    controlMean: mean(ctrlAll),
    edgePerTrade: mean(strat) - mean(ctrlAll),
    strategyMedian: median(strat),
    controlMedian: median(ctrlAll),
    strategyWinRate: strat.length ? strat.filter((r) => r > 0).length / strat.length : NaN,
    controlWinRate: ctrlAll.length ? ctrlAll.filter((r) => r > 0).length / ctrlAll.length : NaN,
    months: monthly.length,
    clusteredT: sd > 0 ? mu / (sd / Math.sqrt(monthly.length)) : NaN,
    monthsAhead: monthly.length ? monthly.filter((x) => x > 0).length / monthly.length : NaN,
  };
}

/** Small, fast, seeded random number generator so control draws are
 * reproducible run to run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
