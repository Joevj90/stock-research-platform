/**
 * Breakout strategy parameters (Pattern Lab, Phase 2).
 *
 * These are STARTING POINTS TO TEST, not tuned values. They come from a
 * hand review of ten hand-picked winners (NVDA, PLTR, SMCI, ASTS, APP,
 * CVNA, TSLA, COIN, RKLB) -- which is exactly the sample most likely to
 * flatter them. Nothing in this file has been shown to beat a random
 * entry yet. Do not tune these against the case studies; the case-study
 * run exists to check that the engine reproduces the hand analysis, not
 * to optimise anything.
 *
 * If you change a value here after a universe backtest has been run,
 * re-run it before trusting any statistic shown next to the signals.
 */

export type LiquidityTier = "large" | "mid" | "small";

export interface BreakoutConfig {
  // ---- Eligibility (checked on the signal day, using only past data) ----
  /** Skip stocks closing below this price. */
  minPrice: number;
  /** Skip stocks whose 20-day average dollar volume is below this. */
  minAvgDollarVolume: number;
  /** 50-day average dollar volume at or above which a stock counts as
   * "large". We have no point-in-time market cap, so liquidity stands in
   * for company size. */
  largeTierDollarVolume: number;
  /** ...and at or above which it counts as "mid". Below is "small". */
  midTierDollarVolume: number;

  // ---- Setup A: tight base breakout ----
  setupA: boolean;
  /** Minimum base length in trading days (3 weeks). */
  baseMinDays: number;
  /** Maximum lookback when measuring the base, in trading days (26 weeks).
   * A base whose highs stay under the pivot for longer than this is
   * accepted and simply measured as 26 weeks. */
  baseMaxDays: number;
  /** A high more than this far above the pivot ends the base (the stock
   * was clearly higher before, so this is not a breakout of the base). */
  baseHighTolerance: number;
  /** Maximum base depth: (highest high - lowest low) / highest high. */
  baseMaxDepth: number;
  /** Length of the "final tight stretch", in trading days (~3 weeks). */
  tightDays: number;
  /** Maximum range of the tight stretch, as a fraction of its high.
   * The approved range to test is 0.10-0.15. */
  tightMaxRange: number;
  /** Volume dry-up: the lowest 10-day average volume inside the tight
   * stretch must be at or below this multiple of the lowest 10-day
   * average over the preceding `dryUpLookbackDays`. 1.0 = a new low. */
  dryUpTolerance: number;
  dryUpLookbackDays: number;
  /** Breakout-day volume must be at least this multiple of the prior
   * 20-day average, by liquidity tier. 1.5x is the large-cap default;
   * small caps get a higher bar because 1.5x is noise for them. */
  breakoutVolumeMultiple: Record<LiquidityTier, number>;

  // ---- Setup B: first pullback after a breakout ----
  setupB: boolean;
  /** The pullback entry must happen this many trading days after the
   * breakout (inclusive window). */
  pullbackMinDays: number;
  pullbackMaxDays: number;
  /** "Near the breakout level or a rising moving average": the pullback
   * low must come within this fraction above the pivot or the 50-day SMA. */
  pullbackNearPct: number;
  /** The pullback must not close more than this far below the pivot. */
  pullbackMaxBreakPct: number;
  /** The turn-up day's volume must exceed the pullback's average volume
   * by this multiple. */
  pullbackTurnVolumeMultiple: number;

  // ---- Setup C: catalyst plus volume expansion ----
  setupC: boolean;
  /** No news feed is available, so a catalyst is proxied from price and
   * volume: an opening gap of at least this much... */
  catalystMinGap: number;
  /** ...or a one-day gain of at least this much... */
  catalystMinDayGain: number;
  /** ...on volume of at least this multiple of the 20-day average... */
  catalystVolumeMultiple: number;
  /** ...closing in the top part of the day's range (0.75 = top quarter). */
  catalystMinCloseLocation: number;
  /** "immediate" = buy the next open after the catalyst day.
   * "retest" = wait for a consolidation that dips back to the catalyst
   * close without closing below the catalyst low, then buy a close above
   * the post-catalyst high. Both are tested; neither is assumed better. */
  catalystEntry: "immediate" | "retest";
  catalystWatchDays: number;
  catalystRetestMinDays: number;

  // ---- Entry timing for Setup A ----
  /** "breakout" = buy the next open after the breakout close.
   * "confirm5" = buy only if no close falls back below the pivot in the
   * next 5 trading days, then buy the following open. */
  entryMode: "breakout" | "confirm5";
  confirmDays: number;

  // ---- Relative strength during index selloffs ----
  /** Index drawdown (from its high within the lookback) that counts as a
   * selloff. */
  selloffMinDrawdown: number;
  selloffLookbackDays: number;
  /** When true, only take signals that showed strength in a recent
   * selloff. Default false: the tag is recorded and reported, so its value
   * can be measured instead of assumed. */
  requireSelloffStrength: boolean;

  // ---- Exits ----
  /** Weekly close below this many weeks' simple moving average of weekly
   * closes exits at the next open. */
  trailingWeeks: number;

  // ---- Re-entry ----
  /** "newSetup" = only a fresh Setup A/B/C signal re-enters.
   * "maReclaim" = additionally re-enter after a trailing exit when a
   * weekly close reclaims the 10-week MA above a higher low (the RKLB
   * finding; one case, unproven). */
  reentryMode: "newSetup" | "maReclaim";
  reclaimMaxWeeks: number;

  // ---- Costs ----
  /** Commission-like cost per side, in basis points. */
  costBpsPerSide: number;
  /** Slippage per side by liquidity tier, in basis points. Applied to
   * every fill, including stops. */
  slippageBps: Record<LiquidityTier, number>;

  // ---- Data hygiene ----
  /** A gap of more than this many calendar days between bars splits a
   * series in two. Catches ticker reuse (BBBY was reassigned to another
   * company after the 2023 bankruptcy) and long halts. */
  maxGapCalendarDays: number;
  /** What happens to a position still open when a stock's data stops
   * before the end of the dataset. "zero" = total loss (conservative:
   * SIVB's data ends near $106 the day before it became nearly
   * worthless). "lastClose" = exit at the last close (flatters failures,
   * but is right for cash takeovers). Every result reports how many
   * trades this touched. */
  delistMode: "zero" | "lastClose";
  /** Data that ends within this many calendar days of the dataset end is
   * treated as still trading, not delisted. */
  delistGraceDays: number;

  // ---- Governance filter ----
  /** Symbols excluded from a date onward (point in time: an exclusion
   * dated 2024 must not affect a 2021 trade). We have no automated source
   * for SEC actions, late filings or auditor changes yet, so this list is
   * maintained by hand and is empty by default. */
  governanceExclusions: GovernanceExclusion[];
}

export interface GovernanceExclusion {
  symbol: string;
  /** ISO date (YYYY-MM-DD) from which signals are ignored. */
  from: string;
  reason: string;
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  minPrice: 1,
  minAvgDollarVolume: 1_000_000,
  largeTierDollarVolume: 500_000_000,
  midTierDollarVolume: 50_000_000,

  setupA: true,
  baseMinDays: 15,
  baseMaxDays: 130,
  baseHighTolerance: 0.05,
  baseMaxDepth: 0.4,
  tightDays: 15,
  tightMaxRange: 0.12,
  dryUpTolerance: 1.15,
  dryUpLookbackDays: 60,
  breakoutVolumeMultiple: { large: 1.5, mid: 2.0, small: 3.0 },

  setupB: true,
  pullbackMinDays: 5,
  pullbackMaxDays: 30,
  pullbackNearPct: 0.03,
  pullbackMaxBreakPct: 0.05,
  pullbackTurnVolumeMultiple: 1.2,

  setupC: true,
  catalystMinGap: 0.04,
  catalystMinDayGain: 0.08,
  catalystVolumeMultiple: 3,
  catalystMinCloseLocation: 0.75,
  catalystEntry: "retest",
  catalystWatchDays: 15,
  catalystRetestMinDays: 3,

  entryMode: "breakout",
  confirmDays: 5,

  selloffMinDrawdown: 0.08,
  selloffLookbackDays: 63,
  requireSelloffStrength: false,

  trailingWeeks: 10,

  reentryMode: "newSetup",
  reclaimMaxWeeks: 52,

  costBpsPerSide: 5,
  slippageBps: { large: 5, mid: 15, small: 30 },

  maxGapCalendarDays: 30,
  delistMode: "zero",
  delistGraceDays: 14,

  governanceExclusions: [],
};

/** Named variants the scripts run side by side. Each changes ONE thing
 * from the default so a difference in results can be attributed to it. */
export const BREAKOUT_VARIANTS: Record<string, Partial<BreakoutConfig>> = {
  default: {},
  confirm5: { entryMode: "confirm5" },
  catalystImmediate: { catalystEntry: "immediate" },
  maReclaim: { reentryMode: "maReclaim" },
  requireSelloffStrength: { requireSelloffStrength: true },
  delistAtLastClose: { delistMode: "lastClose" },
};

export function withConfig(overrides: Partial<BreakoutConfig> = {}): BreakoutConfig {
  return { ...DEFAULT_BREAKOUT_CONFIG, ...overrides };
}
