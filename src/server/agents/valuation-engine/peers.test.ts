import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote } from "@/lib/types";
import type { FinancialPeriod, ValidatedFinancialPeriod } from "@/lib/fundamentals-types";

vi.mock("@/server/market-data", () => ({
  getQuote: vi.fn(),
  getPeerSymbols: vi.fn(),
}));

vi.mock("@/server/fundamentals", () => ({
  getFundamentals: vi.fn(),
}));

const { getQuote, getPeerSymbols } = await import("@/server/market-data");
const { getFundamentals } = await import("@/server/fundamentals");
const { computePeerComparison } = await import("./peers");

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    ticker: "MSFT",
    price: 400,
    change: 1,
    changePercent: 0.25,
    dayHigh: 402,
    dayLow: 398,
    previousClose: 399,
    volume: 1_000_000,
    marketCap: 3_000_000_000_000,
    week52High: 420,
    week52Low: 300,
    avgVolume: 900_000,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function period(overrides: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    source: "fmp",
    ticker: "MSFT",
    periodType: "annual",
    fiscalYear: 2025,
    fiscalQuarter: null,
    reportingPeriodEnd: "2025-06-30T00:00:00.000Z",
    filingDate: null,
    retrievedAt: new Date().toISOString(),
    reportedCurrency: "USD",
    revenue: 250_000_000_000,
    grossProfit: 175_000_000_000,
    operatingIncome: 110_000_000_000,
    netIncome: 90_000_000_000,
    eps: 12,
    cash: 80_000_000_000,
    totalAssets: 500_000_000_000,
    totalLiabilities: 200_000_000_000,
    totalDebt: 60_000_000_000,
    shareholdersEquity: 300_000_000_000,
    operatingCashFlow: 100_000_000_000,
    capitalExpenditures: -20_000_000_000,
    freeCashFlow: 80_000_000_000,
    ebitda: 130_000_000_000,
    dividendsPaid: -20_000_000_000,
    ...overrides,
  };
}

function fundamentalsResultFor(p: FinancialPeriod) {
  const validated: ValidatedFinancialPeriod = { period: p, warnings: [] };
  return { ok: true as const, data: { ticker: p.ticker, periodType: "annual" as const, periods: [validated], ratios: [], metricSeries: {} as never } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computePeerComparison", () => {
  it("fetches peer symbols via the market-data service, never a provider directly", async () => {
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT"] });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote() });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResultFor(period()));

    await computePeerComparison("AAPL", 20, 5);

    expect(getPeerSymbols).toHaveBeenCalledWith("AAPL", 5);
  });

  it("computes peer P/E, P/S, and EV/EBITDA from real quote + fundamentals data", async () => {
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT"] });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: quote({ price: 360, marketCap: 3_000_000_000_000 }),
    });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(
      fundamentalsResultFor(period({ eps: 12, revenue: 250_000_000_000, ebitda: 130_000_000_000, totalDebt: 60_000_000_000, cash: 80_000_000_000 }))
    );

    const result = await computePeerComparison("AAPL", null, null);

    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]!.peRatio).toBeCloseTo(30, 5); // 360/12
    expect(result.peers[0]!.priceToSales).toBeCloseTo(12, 5); // 3T/250B
    expect(result.averagePeRatio).toBeCloseTo(30, 5);
  });

  it("skips a peer whose data couldn't be fetched, rather than failing the whole comparison", async () => {
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT", "BADTICKER"] });
    (getQuote as ReturnType<typeof vi.fn>).mockImplementation((ticker: string) =>
      ticker === "MSFT"
        ? Promise.resolve({ ok: true, data: quote() })
        : Promise.resolve({ ok: false, error: { code: "INVALID_TICKER", message: "bad" } })
    );
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResultFor(period()));

    const result = await computePeerComparison("AAPL", null, null);
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]!.ticker).toBe("MSFT");
  });

  it("returns an empty comparison (not an error) when the peer-symbols lookup fails", async () => {
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await computePeerComparison("AAPL", 20, 5);
    expect(result.peers).toEqual([]);
    expect(result.averagePeRatio).toBeNull();
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("computes current-vs-peer-average percentage difference", async () => {
    (getPeerSymbols as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: ["MSFT"] });
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: quote({ price: 240, marketCap: 3_000_000_000_000 }) });
    (getFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue(fundamentalsResultFor(period({ eps: 12 })));

    // peer P/E = 240/12 = 20; current P/E = 30 -> 50% more expensive than peer average
    const result = await computePeerComparison("AAPL", 30, null);
    expect(result.currentPeVsPeerAveragePct).toBeCloseTo(50, 5);
  });
});
