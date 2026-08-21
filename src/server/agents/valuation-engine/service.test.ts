import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar, Quote } from "@/lib/types";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { ValuationInterpretation } from "@/lib/valuation-types";

vi.mock("@/server/market-data", () => ({
  getQuote: vi.fn(),
  getHistoricalPrices: vi.fn(),
}));

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretValuation: vi.fn(),
}));

vi.mock("./peers", () => ({
  computePeerComparison: vi.fn(),
}));

const { getQuote, getHistoricalPrices } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { interpretValuation } = await import("./interpreter");
const { computePeerComparison } = await import("./peers");
const { runValuationAnalysis } = await import("./service");

function quote(): Quote {
  return {
    ticker: "AAPL",
    price: 200,
    change: 1,
    changePercent: 0.5,
    dayHigh: 202,
    dayLow: 198,
    previousClose: 199,
    volume: 1_000_000,
    marketCap: 2_000_000_000_000,
    week52High: 220,
    week52Low: 150,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
  };
}

function bars(): PriceBar[] {
  return [{ timestamp: "2025-09-30T00:00:00.000Z", open: 195, high: 205, low: 190, close: 200, volume: 1000 }];
}

function period(fiscalYear: number, eps: number): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear,
    fiscalQuarter: null,
    reportingPeriodEnd: `${fiscalYear}-09-30T00:00:00.000Z`,
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: 100_000_000_000,
    grossProfit: 40_000_000_000,
    operatingIncome: 25_000_000_000,
    netIncome: 20_000_000_000,
    eps,
    cash: 10_000_000_000,
    totalAssets: 200_000_000_000,
    totalLiabilities: 100_000_000_000,
    totalDebt: 30_000_000_000,
    shareholdersEquity: 100_000_000_000,
    operatingCashFlow: 22_000_000_000,
    capitalExpenditures: -5_000_000_000,
    freeCashFlow: 17_000_000_000,
    ebitda: 30_000_000_000,
    dividendsPaid: -3_000_000_000,
  };
}

function fundamentalsResult(periods: FinancialPeriod[]) {
  const validated: ValidatedFinancialPeriod[] = periods.map((p) => ({ period: p, warnings: [] }));
  return { ok: true as const, data: { ticker: "AAPL", periodType: "annual" as const, periods: validated, ratios: [], metricSeries: {} as never } };
}

const SAMPLE_INTERPRETATION: ValuationInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  rating: "reasonably_priced",
  explanation: "x",
  biggestUncertainty: "y",
  assumptionExplanations: [],
  confidenceScore: 0.7,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runValuationAnalysis", () => {
  it("fetches data exclusively via the market-data and fundamentals barrels, never a provider directly", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult([period(2025, 6.5)]));
    (computePeerComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "calculated",
      peers: [],
      averagePeRatio: null,
      averagePriceToSales: null,
      averageEvToEbitda: null,
      currentPeVsPeerAveragePct: null,
      currentPsVsPeerAveragePct: null,
    });
    (interpretValuation as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runValuationAnalysis("AAPL");

    expect(getQuote).toHaveBeenCalledWith("AAPL");
    expect(getHistoricalPrices).toHaveBeenCalledWith("AAPL", "5Y");
    expect(getFundamentals).toHaveBeenCalledWith("AAPL", "annual");
    expect(result.ok).toBe(true);
  });

  it("returns calculated valuation data and AI interpretation as separate objects", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult([period(2025, 6.5)]));
    (computePeerComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "calculated",
      peers: [],
      averagePeRatio: null,
      averagePriceToSales: null,
      averageEvToEbitda: null,
      currentPeVsPeerAveragePct: null,
      currentPsVsPeerAveragePct: null,
    });
    (interpretValuation as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runValuationAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metrics.source).toBe("calculated");
      expect(result.data.dcf.source).toBe("calculated");
      expect(result.data.interpretation.source).toBe("ai");
      expect(result.data.dcf).toHaveProperty("bear");
      expect(result.data.dcf).toHaveProperty("base");
      expect(result.data.dcf).toHaveProperty("bull");
      expect(result.data.dcf.sensitivity).toHaveLength(4);
    }
  });

  it("propagates a quote-fetch error without calling the interpreter", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runValuationAnalysis("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretValuation).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_DATA when there are no financial periods, without calling the interpreter", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult([]));

    const result = await runValuationAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INSUFFICIENT_DATA");
    expect(interpretValuation).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED) after calculation still ran", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult([period(2025, 6.5)]));
    (computePeerComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "calculated",
      peers: [],
      averagePeRatio: null,
      averagePriceToSales: null,
      averageEvToEbitda: null,
      currentPeVsPeerAveragePct: null,
      currentPsVsPeerAveragePct: null,
    });
    (interpretValuation as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runValuationAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runValuationAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("computes EPS growth from the two most recent periods for use in PEG and DCF assumptions", async () => {
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: bars() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(
      fundamentalsResult([period(2024, 5), period(2025, 6)]) // 20% EPS growth
    );
    (computePeerComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      source: "calculated",
      peers: [],
      averagePeRatio: null,
      averagePriceToSales: null,
      averageEvToEbitda: null,
      currentPeVsPeerAveragePct: null,
      currentPsVsPeerAveragePct: null,
    });
    (interpretValuation as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runValuationAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // P/E = 200/6 ≈ 33.3; growth = 20 -> PEG ≈ 1.67
      expect(result.data.metrics.pegRatio.value).toBeCloseTo(200 / 6 / 20, 3);
    }
  });
});
