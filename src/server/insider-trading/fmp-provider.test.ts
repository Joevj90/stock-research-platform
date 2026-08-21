import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmpInsiderTradingProvider } from "./fmp-provider";

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const SAMPLE_ROW = {
  reportingName: "Cook Timothy D",
  typeOfOwner: "officer: Chief Executive Officer",
  transactionType: "S-Sale",
  acquistionOrDisposition: "D",
  transactionDate: "2026-08-01",
  filingDate: "2026-08-03",
  securitiesTransacted: 50000,
  price: 220.5,
  link: "https://www.sec.gov/Archives/edgar/data/example",
};

describe("FmpInsiderTradingProvider", () => {
  const provider = new FmpInsiderTradingProvider("test-key");

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("throws at construction time if no API key is provided", () => {
    expect(() => new FmpInsiderTradingProvider("")).toThrow(/FMP_API_KEY/);
  });

  it("rejects malformed tickers before calling the network", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await provider.getInsiderTransactions("bad ticker!!", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a sale transaction and preserves the real SEC filing URL", async () => {
    mockFetchOnce(200, [SAMPLE_ROW]);

    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        reportingName: "Cook Timothy D",
        transactionType: "sale",
        shares: 50000,
        pricePerShare: 220.5,
        url: "https://www.sec.gov/Archives/edgar/data/example",
      });
    }
  });

  it("normalizes a purchase transaction correctly", async () => {
    mockFetchOnce(200, [{ ...SAMPLE_ROW, transactionType: "P-Purchase", acquistionOrDisposition: "A" }]);
    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]!.transactionType).toBe("purchase");
  });

  it("classifies an unrecognized transaction code as 'other' rather than guessing", async () => {
    mockFetchOnce(200, [{ ...SAMPLE_ROW, transactionType: "A-Award", acquistionOrDisposition: undefined }]);
    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]!.transactionType).toBe("other");
  });

  it("filters out rows missing required dates rather than crashing", async () => {
    mockFetchOnce(200, [SAMPLE_ROW, { reportingName: "Missing dates" }]);
    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it("maps HTTP 402 to PROVIDER_PLAN_REQUIRED", async () => {
    mockFetchOnce(402, {});
    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
  });

  it("surfaces a network failure as PROVIDER_UNREACHABLE", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await provider.getInsiderTransactions("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNREACHABLE");
  });
});
