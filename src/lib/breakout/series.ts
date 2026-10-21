/**
 * Price series helpers for the breakout backtest.
 *
 * Series are columnar (one array per field) because the universe run
 * holds thousands of ten-year daily histories in memory at once.
 * Dates are plain YYYY-MM-DD strings in exchange-local trading days.
 *
 * Every rolling calculation here looks BACKWARD only. Value i depends on
 * bars 0..i and nothing later -- the no-lookahead test in
 * signals.test.ts enforces this for the whole signal pipeline.
 */

export interface DailySeries {
  symbol: string;
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/** A contiguous piece of a series, plus whether it ended because the
 * stock stopped trading (delisting, bankruptcy, takeover, ticker reuse)
 * rather than because the dataset ended. */
export interface Segment extends DailySeries {
  /** Which piece of the original series this is (0-based). */
  segmentIndex: number;
  endsAbruptly: boolean;
}

const DAY_MS = 86_400_000;

export function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

function slice(s: DailySeries, from: number, to: number): DailySeries {
  return {
    symbol: s.symbol,
    dates: s.dates.slice(from, to),
    open: s.open.slice(from, to),
    high: s.high.slice(from, to),
    low: s.low.slice(from, to),
    close: s.close.slice(from, to),
    volume: s.volume.slice(from, to),
  };
}

/** Truncate a series to its first `n` bars. Used by the no-lookahead test. */
export function truncate(s: DailySeries, n: number): DailySeries {
  return slice(s, 0, n);
}

/**
 * Split a series wherever consecutive bars are more than
 * `maxGapCalendarDays` apart. A long gap almost always means the ticker
 * stopped trading and was later reassigned (BBBY) or the stock was halted
 * for weeks; either way, a position must not be carried across it.
 *
 * `datasetEnd` is the last date of the whole dataset. A segment whose
 * last bar is more than `graceDays` before it is marked `endsAbruptly`.
 */
export function splitOnGaps(
  s: DailySeries,
  maxGapCalendarDays: number,
  datasetEnd: string,
  graceDays: number,
): Segment[] {
  const out: Segment[] = [];
  if (s.dates.length === 0) return out;
  let start = 0;
  for (let i = 1; i <= s.dates.length; i++) {
    const isEnd = i === s.dates.length;
    const gap = isEnd ? 0 : daysBetween(s.dates[i - 1]!, s.dates[i]!);
    if (isEnd || gap > maxGapCalendarDays) {
      const piece = slice(s, start, i);
      const last = piece.dates[piece.dates.length - 1]!;
      out.push({
        ...piece,
        segmentIndex: out.length,
        endsAbruptly: !isEnd || daysBetween(last, datasetEnd) > graceDays,
      });
      start = i;
    }
  }
  return out;
}

/** Simple moving average; NaN until `period` values exist. */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Average of the `period` values BEFORE i (excludes i itself). Used for
 * "volume vs its 20-day average", where today's spike must not inflate
 * its own baseline. NaN until enough history exists. */
export function priorAverage(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i >= period) out[i] = sum / period;
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
  }
  return out;
}

/** Monday (UTC) of the week containing `date`, as YYYY-MM-DD. */
export function weekKey(date: string): string {
  const ms = toUtcMs(date);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return new Date(ms - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Per-day weekly view, without lookahead:
 *  - `weekIndex[i]`: which week day i belongs to.
 *  - `isWeekEnd[i]`: day i is the last trading day of its week. Knowing
 *    this needs tomorrow's date, which is calendar knowledge, not price
 *    knowledge. The final bar of a series is never a week end, because we
 *    cannot know the week is over.
 *  - `weeklySma[i]`: SMA of weekly closes over `weeks` weeks, INCLUDING
 *    the week ending on day i. Only meaningful where isWeekEnd[i].
 *  - `weekLow[i]`: lowest low of day i's week so far.
 */
export interface WeeklyView {
  weekIndex: number[];
  isWeekEnd: boolean[];
  weeklySma: number[];
  weekLow: number[];
}

export function weeklyView(s: DailySeries, weeks: number): WeeklyView {
  const n = s.dates.length;
  const weekIndex = new Array<number>(n);
  const isWeekEnd = new Array<boolean>(n).fill(false);
  const weeklySma = new Array<number>(n).fill(NaN);
  const weekLow = new Array<number>(n).fill(NaN);
  const weeklyCloses: number[] = [];
  let w = -1;
  let prevKey = "";
  let runningLow = Infinity;
  for (let i = 0; i < n; i++) {
    const key = weekKey(s.dates[i]!);
    if (key !== prevKey) {
      w++;
      prevKey = key;
      runningLow = Infinity;
    }
    weekIndex[i] = w;
    runningLow = Math.min(runningLow, s.low[i]!);
    weekLow[i] = runningLow;
    const nextKey = i + 1 < n ? weekKey(s.dates[i + 1]!) : null;
    if (nextKey !== null && nextKey !== key) {
      isWeekEnd[i] = true;
      weeklyCloses.push(s.close[i]!);
      if (weeklyCloses.length >= weeks) {
        let sum = 0;
        for (let k = weeklyCloses.length - weeks; k < weeklyCloses.length; k++) sum += weeklyCloses[k]!;
        weeklySma[i] = sum / weeks;
      }
    }
  }
  return { weekIndex, isWeekEnd, weeklySma, weekLow };
}
