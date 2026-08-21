import type { FinancialPeriod } from "@/lib/fundamentals-types";
import type { DcfAssumptions, DcfResult, DcfScenario, SensitivityRow } from "@/lib/valuation-types";

/**
 * Deterministic Discounted Cash Flow engine. Every number here is plain
 * arithmetic over explicit, labeled assumptions -- "The DCF calculations
 * must be performed deterministically in backend code. Do NOT rely on an
 * LLM to perform important mathematical calculations." The AI
 * interpretation layer (interpreter.ts) never touches this math; it only
 * reads the finished numbers.
 *
 * Method: project unlevered free cash flow for `projectionYears`, with
 * revenue growth fading linearly from `initialRevenueGrowthPct` toward
 * `terminalRevenueGrowthPct`; discount each year's FCF to present value;
 * add a Gordon Growth terminal value; subtract net debt; divide by
 * shares outstanding. This is a standard, well-documented DCF structure
 * -- not a novel or opaque formula.
 */
export function runDcfScenario(
  latestPeriod: FinancialPeriod,
  sharesOutstanding: number | null,
  assumptions: DcfAssumptions,
  scenarioName: DcfScenario["name"],
  currentPrice: number
): DcfScenario {
  const fairValuePerShare = computeFairValuePerShare(latestPeriod, sharesOutstanding, assumptions);
  const impliedUpsideDownsidePct =
    fairValuePerShare !== null && currentPrice > 0
      ? ((fairValuePerShare - currentPrice) / currentPrice) * 100
      : null;

  return { name: scenarioName, assumptions, fairValuePerShare, impliedUpsideDownsidePct };
}

/** The core DCF math, isolated as its own pure function so both the
 * three named scenarios and the sensitivity grid (which reruns this with
 * one assumption nudged at a time) share exactly one implementation. */
export function computeFairValuePerShare(
  latestPeriod: FinancialPeriod,
  sharesOutstanding: number | null,
  a: DcfAssumptions
): number | null {
  if (latestPeriod.revenue === null || latestPeriod.revenue <= 0) return null;
  if (sharesOutstanding === null || sharesOutstanding <= 0) return null;
  if (a.discountRatePct <= a.terminalGrowthRatePct) return null; // Gordon Growth requires r > g

  const discountRate = a.discountRatePct / 100;
  const terminalGrowth = a.terminalGrowthRatePct / 100;
  const taxRate = a.taxRatePct / 100;
  const operatingMargin = a.operatingMarginPct / 100;
  const capexPct = a.capexAsPctOfRevenue / 100;
  const wcPct = a.workingCapitalChangeAsPctOfRevenue / 100;

  let revenue = latestPeriod.revenue;
  let presentValueOfFcf = 0;
  let lastFcf = 0;

  for (let year = 1; year <= a.projectionYears; year++) {
    const t = a.projectionYears > 1 ? (year - 1) / (a.projectionYears - 1) : 1;
    const growthThisYear =
      a.initialRevenueGrowthPct + (a.terminalRevenueGrowthPct - a.initialRevenueGrowthPct) * t;
    revenue = revenue * (1 + growthThisYear / 100);

    const operatingIncome = revenue * operatingMargin;
    const nopat = operatingIncome * (1 - taxRate); // net operating profit after tax
    const capex = revenue * capexPct;
    const workingCapitalChange = revenue * wcPct;
    const unleveredFcf = nopat - capex - workingCapitalChange;

    const discountFactor = Math.pow(1 + discountRate, year);
    presentValueOfFcf += unleveredFcf / discountFactor;
    lastFcf = unleveredFcf;
  }

  const terminalValue = (lastFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const presentValueOfTerminal = terminalValue / Math.pow(1 + discountRate, a.projectionYears);

  const enterpriseValue = presentValueOfFcf + presentValueOfTerminal;
  const netDebt = subtractOrNull(latestPeriod.totalDebt, latestPeriod.cash) ?? 0;
  const equityValue = enterpriseValue - netDebt;

  if (equityValue <= 0) return 0; // model implies the equity is worthless under these assumptions
  return equityValue / sharesOutstanding;
}

/** Derives an implied share count from real reported figures (net income
 * / eps) rather than requiring a separate "shares outstanding" data
 * source this app doesn't have -- both inputs are real, so the result is
 * a real derived number, not a fabricated one. Null if not derivable. */
export function deriveSharesOutstanding(latestPeriod: FinancialPeriod): number | null {
  if (latestPeriod.netIncome === null || latestPeriod.eps === null || latestPeriod.eps === 0) return null;
  const shares = latestPeriod.netIncome / latestPeriod.eps;
  return shares > 0 ? shares : null;
}

export function buildSensitivity(
  latestPeriod: FinancialPeriod,
  sharesOutstanding: number | null,
  base: DcfAssumptions
): SensitivityRow[] {
  const revenueGrowthDeltas = [-6, -3, 0, 3, 6];
  const marginDeltas = [-4, -2, 0, 2, 4];
  const discountRateDeltas = [-2, -1, 0, 1, 2];
  const terminalGrowthDeltas = [-1, -0.5, 0, 0.5, 1];

  const runWith = (overrides: Partial<DcfAssumptions>) =>
    computeFairValuePerShare(latestPeriod, sharesOutstanding, { ...base, ...overrides });

  return [
    {
      parameter: "revenueGrowth",
      results: revenueGrowthDeltas.map((delta) => ({
        delta,
        fairValuePerShare: runWith({
          initialRevenueGrowthPct: base.initialRevenueGrowthPct + delta,
          terminalRevenueGrowthPct: base.terminalRevenueGrowthPct + delta,
        }),
      })),
    },
    {
      parameter: "operatingMargin",
      results: marginDeltas.map((delta) => ({
        delta,
        fairValuePerShare: runWith({ operatingMarginPct: base.operatingMarginPct + delta }),
      })),
    },
    {
      parameter: "discountRate",
      results: discountRateDeltas.map((delta) => ({
        delta,
        fairValuePerShare: runWith({ discountRatePct: base.discountRatePct + delta }),
      })),
    },
    {
      parameter: "terminalGrowth",
      results: terminalGrowthDeltas.map((delta) => ({
        delta,
        fairValuePerShare: runWith({ terminalGrowthRatePct: base.terminalGrowthRatePct + delta }),
      })),
    },
  ];
}

/**
 * Builds bear/base/bull assumptions from real historical data where
 * possible (recent revenue growth rate, current operating margin) rather
 * than arbitrary numbers, then applies conservative/optimistic
 * adjustments in each direction -- "Do not choose assumptions simply to
 * justify the current stock price."
 */
export function buildScenarioAssumptions(
  latestPeriod: FinancialPeriod,
  recentRevenueGrowthPct: number | null
): { bear: DcfAssumptions; base: DcfAssumptions; bull: DcfAssumptions } {
  // Anchor the base case on real recent performance; fall back to a
  // conservative default only when no real growth figure is available.
  const observedGrowth = recentRevenueGrowthPct ?? 5;
  const observedMargin =
    latestPeriod.revenue && latestPeriod.revenue > 0 && latestPeriod.operatingIncome !== null
      ? (latestPeriod.operatingIncome / latestPeriod.revenue) * 100
      : 15;

  const baseAssumptions: DcfAssumptions = {
    initialRevenueGrowthPct: clamp(observedGrowth, -10, 40),
    terminalRevenueGrowthPct: 3,
    operatingMarginPct: clamp(observedMargin, 0, 60),
    taxRatePct: 21,
    capexAsPctOfRevenue: 5,
    workingCapitalChangeAsPctOfRevenue: 1,
    discountRatePct: 9,
    terminalGrowthRatePct: 2.5,
    projectionYears: 5,
  };

  const bear: DcfAssumptions = {
    ...baseAssumptions,
    initialRevenueGrowthPct: baseAssumptions.initialRevenueGrowthPct - 6,
    operatingMarginPct: Math.max(0, baseAssumptions.operatingMarginPct - 4),
    discountRatePct: baseAssumptions.discountRatePct + 1.5,
    terminalGrowthRatePct: Math.max(0, baseAssumptions.terminalGrowthRatePct - 1),
  };

  const bull: DcfAssumptions = {
    ...baseAssumptions,
    initialRevenueGrowthPct: baseAssumptions.initialRevenueGrowthPct + 6,
    operatingMarginPct: Math.min(60, baseAssumptions.operatingMarginPct + 4),
    discountRatePct: Math.max(4, baseAssumptions.discountRatePct - 1),
    terminalGrowthRatePct: baseAssumptions.terminalGrowthRatePct + 0.5,
  };

  return { bear, base: baseAssumptions, bull };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function subtractOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}
