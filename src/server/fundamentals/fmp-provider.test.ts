import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmpFundamentalsProvider } from "./fmp-provider";

function mockFetchSequence(responses: { status: number; body: unknown }[]) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call++;
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    });
  }) as unknown as typeof fetch;
}

const INCOME_ROW = {
  date: "2025-09-30",
  fiscalYear: 2025,
  period: "FY",
  filingDate: "2025-10-30",
  reportedCurrency: "USD",
  revenue: 400_000_000_000,
  grossProfit: 180_000_000_000,
  operatingIncome: 120_000_000_000,
  netIncome: 100_000_000_000,
  eps: 6.5,
};

const BALANCE_ROW = {
  date: "2025-09-30",
  cashAndCashEquivalents: 30_000_000_000,
  totalAssets: 350_000_000_000,
  totalLiabilities: 250_000_000_000,
  totalDebt: 100_000_000_000,
  totalStockholdersEquity: 100_000_000_000,
};

const CASH_FLOW_ROW = {
  date: "2025-09-30",
  operatingCashFlow: 110_000_000_000,
  capitalExpenditure: -10_000_000_000,
  freeCashFlow: 100_000_000_000,
};

describe("FmpFundamentalsProvider", () => {
  const provider = new FmpFundamentalsProvider("test-key");

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("throws at construction time if no API key is provided", () => {
    expect(() => new FmpFundamentalsProvider("")).toThrow(/FMP_API_KEY/);
  });

  it("rejects malformed tickers before calling the network", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await provider.getFinancials("bad ticker!!", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("merges income/balance/cash-flow rows by date into one normalized period", async () => {
    mockFetchSequence([
      { status: 200, body: [INCOME_ROW] },
      { status: 200, body: [BALANCE_ROW] },
      { status: 200, body: [CASH_FLOW_ROW] },
    ]);

    const result = await provider.getFinancials("AAPL", "annual", 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      const p = result.data[0]!;
      expect(p.revenue).toBe(400_000_000_000);
      expect(p.cash).toBe(30_000_000_000);
      expect(p.freeCashFlow).toBe(100_000_000_000);
      expect(p.fiscalYear).toBe(2025);
      expect(p.periodType).toBe("annual");
      expect(p.fiscalQuarter).toBeNull();
      expect(p.source).toBe("fmp");
    }
  });

  it("parses fiscal quarter for quarterly periods", async () => {
    mockFetchSequence([
      { status: 200, body: [{ ...INCOME_ROW, period: "Q2" }] },
      { status: 200, body: [BALANCE_ROW] },
      { status: 200, body: [CASH_FLOW_ROW] },
    ]);

    const result = await provider.getFinancials("AAPL", "quarterly", 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]!.fiscalQuarter).toBe(2);
  });

  it("leaves balance/cash-flow fields null if that statement has no matching row for a date", async () => {
    mockFetchSequence([
      { status: 200, body: [INCOME_ROW] },
      { status: 200, body: [] }, // no matching balance sheet row
      { status: 200, body: [CASH_FLOW_ROW] },
    ]);

    const result = await provider.getFinancials("AAPL", "annual", 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]!.cash).toBeNull();
      expect(result.data[0]!.totalAssets).toBeNull();
      expect(result.data[0]!.freeCashFlow).toBe(100_000_000_000); // cash flow row still matched
    }
  });

  it("treats an empty income statement response as an invalid ticker", async () => {
    mockFetchSequence([
      { status: 200, body: [] },
      { status: 200, body: [] },
      { status: 200, body: [] },
    ]);

    const result = await provider.getFinancials("ZZZZZ", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
  });

  it("maps HTTP 401 to a provider auth error", async () => {
    mockFetchSequence([{ status: 401, body: {} }]);
    const result = await provider.getFinancials("AAPL", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_AUTH_ERROR");
  });

  it("maps HTTP 402 to PROVIDER_PLAN_REQUIRED with a clear upgrade message", async () => {
    mockFetchSequence([{ status: 402, body: {} }]);
    const result = await provider.getFinancials("AAPL", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
      expect(result.error.message).toContain("paid FMP plan");
    }
  });

  it("maps HTTP 429 to a rate-limit error", async () => {
    mockFetchSequence([{ status: 429, body: {} }]);
    const result = await provider.getFinancials("AAPL", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("surfaces a network failure as PROVIDER_UNREACHABLE", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await provider.getFinancials("AAPL", "annual", 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNREACHABLE");
  });
});
