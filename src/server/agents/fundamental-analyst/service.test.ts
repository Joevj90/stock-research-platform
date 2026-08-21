import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { FundamentalAnalystInterpretation } from "@/lib/fundamental-analyst-types";

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretFundamentalMetrics: vi.fn(),
}));

const { getFundamentals } = await import("@/server/fundamentals");
const { interpretFundamentalMetrics } = await import("./interpreter");
const { runFundamentalAnalysis } = await import("./service");

function period(fiscalYear: number, revenue: number): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear,
    fiscalQuarter: null,
    reportingPeriodEnd: `${fiscalYear}-09-30T00:00:00.000Z`,
    filingDate: `${fiscalYear}-10-30T00:00:00.000Z`,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue,
    grossProfit: revenue * 0.4,
    operatingIncome: revenue * 0.25,
    netIncome: revenue * 0.2,
    eps: 5,
    cash: revenue * 0.1,
    totalAssets: revenue * 2,
    totalLiabilities: revenue * 1.2,
    totalDebt: revenue * 0.5,
    shareholdersEquity: revenue * 0.8,
    operatingCashFlow: revenue * 0.22,
    capitalExpenditures: -revenue * 0.05,
    freeCashFlow: revenue * 0.17,
    ebitda: revenue * 0.3,
    dividendsPaid: -revenue * 0.02,
  };
}

function validated(p: FinancialPeriod): ValidatedFinancialPeriod {
  return { period: p, warnings: [] };
}

const SAMPLE_INTERPRETATION: FundamentalAnalystInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  overallFundamentalScore: 60,
  confidenceScore: 0.8,
  revenueAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  earningsAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  profitabilityAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  cashFlowAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  balanceSheetAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  growthAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  financialStrengthAssessment: { whatHappened: "x", whyItMatters: "y", isGoodOrBad: "z" },
  positiveFactors: ["Revenue grew"],
  negativeFactors: [],
  importantTrends: [],
  keyConcerns: [],
  overallConclusion: "Healthy overall.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFundamentalAnalysis", () => {
  it("fetches financial data via Step 5's getFundamentals, never a provider directly", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        ticker: "AAPL",
        periodType: "annual",
        periods: [validated(period(2024, 380e9)), validated(period(2025, 400e9))],
        ratios: [],
        metricSeries: {},
      },
    });
    (interpretFundamentalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    const result = await runFundamentalAnalysis("AAPL", "annual");

    expect(getFundamentals).toHaveBeenCalledWith("AAPL", "annual");
    expect(result.ok).toBe(true);
  });

  it("returns calculated and interpretation as separate, clearly-sourced objects", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        ticker: "AAPL",
        periodType: "annual",
        periods: [validated(period(2025, 400e9))],
        ratios: [],
        metricSeries: {},
      },
    });
    (interpretFundamentalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    const result = await runFundamentalAnalysis("AAPL", "annual");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.calculated.source).toBe("calculated");
      expect(result.data.interpretation.source).toBe("ai");
      expect(result.data.calculated).not.toHaveProperty("overallFundamentalScore");
      expect(result.data.interpretation).not.toHaveProperty("revenueGrowthPct");
    }
  });

  it("propagates a Step 5 error without calling the interpreter", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runFundamentalAnalysis("ZZZZZ", "annual");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretFundamentalMetrics).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_DATA when Step 5 returns zero periods", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: { ticker: "AAPL", periodType: "annual", periods: [], ratios: [], metricSeries: {} },
    });

    const result = await runFundamentalAnalysis("AAPL", "annual");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INSUFFICIENT_DATA");
    expect(interpretFundamentalMetrics).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED) after calculation still ran", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        ticker: "AAPL",
        periodType: "annual",
        periods: [validated(period(2025, 400e9))],
        ratios: [],
        metricSeries: {},
      },
    });
    (interpretFundamentalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runFundamentalAnalysis("AAPL", "annual");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
    expect(interpretFundamentalMetrics).toHaveBeenCalled();
  });

  it("defaults to the annual period when none is given", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: {
        ticker: "AAPL",
        periodType: "annual",
        periods: [validated(period(2025, 400e9))],
        ratios: [],
        metricSeries: {},
      },
    });
    (interpretFundamentalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    await runFundamentalAnalysis("AAPL");

    expect(getFundamentals).toHaveBeenCalledWith("AAPL", "annual");
  });

  it("rejects an empty ticker before touching the fundamentals service", async () => {
    const result = await runFundamentalAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getFundamentals).not.toHaveBeenCalled();
  });
});
