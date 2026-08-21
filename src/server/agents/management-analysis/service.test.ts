import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockSnapshot } from "@/lib/types";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";
import type { InsiderTransaction } from "@/lib/insider-trading-types";
import type { ManagementInterpretation } from "@/lib/management-types";

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

vi.mock("@/server/insider-trading", () => ({
  getInsiderTransactions: vi.fn(),
}));

vi.mock("@/server/market-data", () => ({
  getStockSnapshot: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretManagement: vi.fn(),
}));

const { getFundamentals } = await import("@/server/fundamentals");
const { getInsiderTransactions } = await import("@/server/insider-trading");
const { getStockSnapshot } = await import("@/server/market-data");
const { interpretManagement } = await import("./interpreter");
const { runManagementAnalysis } = await import("./service");

function period(): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "AAPL",
    periodType: "annual",
    fiscalYear: 2025,
    fiscalQuarter: null,
    reportingPeriodEnd: "2025-09-30T00:00:00.000Z",
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: 100,
    grossProfit: null,
    operatingIncome: null,
    netIncome: 20,
    eps: 2,
    cash: 10,
    totalAssets: null,
    totalLiabilities: null,
    totalDebt: 30,
    shareholdersEquity: 50,
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow: 17,
    ebitda: null,
    dividendsPaid: -5,
  };
}

function fundamentalsResult() {
  const validated: ValidatedFinancialPeriod = { period: period(), warnings: [] };
  return { ok: true as const, data: { ticker: "AAPL", periodType: "annual" as const, periods: [validated], ratios: [], metricSeries: {} as never } };
}

function transaction(): InsiderTransaction {
  return {
    ticker: "AAPL",
    reportingName: "Someone",
    role: "officer",
    transactionType: "sale",
    transactionDate: "2026-08-01T00:00:00.000Z",
    filingDate: "2026-08-03T00:00:00.000Z",
    shares: 1000,
    pricePerShare: 200,
    url: null,
    provider: "fmp",
    retrievedAt: new Date().toISOString(),
  };
}

function snapshot(): StockSnapshot {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    quote: {
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
    },
    history: [],
    period: "1M",
    provenance: { provider: "mock", isMock: true, fetchedAt: new Date().toISOString(), fromCache: false },
  };
}

const SAMPLE_INTERPRETATION: ManagementInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  managementScore: 20,
  overallAssessment: "good",
  confidenceScore: 0.6,
  whatManagementIsDoingWell: [],
  managementConcerns: [],
  trackRecordVsGuidance: "Not available.",
  capitalAllocationAssessment: "x",
  insiderActivityAssessment: "x",
  managementCredibility: "medium",
  managementCredibilityExplanation: "x",
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runManagementAnalysis", () => {
  it("fetches data via the fundamentals, insider-trading, and market-data barrels, never a provider directly", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [transaction()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretManagement as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runManagementAnalysis("AAPL");

    expect(getFundamentals).toHaveBeenCalledWith("AAPL", "annual");
    expect(getInsiderTransactions).toHaveBeenCalledWith("AAPL");
    expect(result.ok).toBe(true);
  });

  it("computes real capital-allocation and insider-activity signals and passes them to the interpreter", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [transaction()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretManagement as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runManagementAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.capitalAllocation.source).toBe("calculated");
      expect(result.data.insiderActivity.saleCount).toBe(1);
      expect(result.data.interpretation.source).toBe("ai");
    }

    const call = (interpretManagement as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.companyName).toBe("Apple Inc.");
  });

  it("proceeds with a null company name if the snapshot lookup fails", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad" },
    });
    (interpretManagement as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runManagementAnalysis("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.companyName).toBeNull();
  });

  it("propagates a fundamentals error without calling the interpreter", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await runManagementAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
    expect(interpretManagement).not.toHaveBeenCalled();
  });

  it("propagates an insider-trading error without calling the interpreter", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await runManagementAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
    expect(interpretManagement).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResult());
    (getInsiderTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretManagement as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runManagementAnalysis("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runManagementAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getFundamentals).not.toHaveBeenCalled();
  });
});
