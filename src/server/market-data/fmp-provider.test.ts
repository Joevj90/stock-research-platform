import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmpMarketDataProvider } from "./fmp-provider";

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("FmpMarketDataProvider", () => {
  const provider = new FmpMarketDataProvider("test-key");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws at construction time if no API key is provided", () => {
    expect(() => new FmpMarketDataProvider("")).toThrow(/FMP_API_KEY/);
  });

  it("rejects malformed tickers before calling the network", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await provider.getQuote("not a ticker!!");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a successful quote response into the app's Quote shape", async () => {
    mockFetchOnce(200, [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        price: 227.5,
        change: -1.25,
        changePercentage: -0.55,
        dayHigh: 229.1,
        dayLow: 226.0,
        previousClose: 228.75,
        volume: 45_000_000,
        avgVolume: 50_000_000,
        marketCap: 3_500_000_000_000,
        yearHigh: 260.1,
        yearLow: 164.0,
      },
    ]);

    const result = await provider.getQuote("AAPL");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        ticker: "AAPL",
        price: 227.5,
        previousClose: 228.75,
        marketCap: 3_500_000_000_000,
        week52High: 260.1,
        week52Low: 164.0,
        avgVolume: 50_000_000,
      });
    }
  });

  it("treats an empty quote array as an invalid ticker", async () => {
    mockFetchOnce(200, []);
    const result = await provider.getQuote("ZZZZZ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
  });

  it("maps HTTP 401/403 to a provider auth error", async () => {
    mockFetchOnce(401, { message: "Unauthorized" });
    const result = await provider.getQuote("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_AUTH_ERROR");
  });

  it("maps HTTP 429 to a rate-limit error", async () => {
    mockFetchOnce(429, {});
    const result = await provider.getQuote("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("treats FMP's 200-status 'Error Message' body as a provider error", async () => {
    mockFetchOnce(200, { "Error Message": "Invalid API key." });
    const result = await provider.getQuote("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(result.error.message).toContain("Invalid API key");
    }
  });

  it("parses historical bars (flat array response) oldest-first regardless of FMP's order", async () => {
    mockFetchOnce(200, [
      { symbol: "AAPL", date: "2026-08-20", open: 227, high: 229, low: 226, close: 227.5, volume: 100 },
      { symbol: "AAPL", date: "2026-08-19", open: 225, high: 228, low: 224, close: 227, volume: 90 },
      { symbol: "AAPL", date: "2026-08-18", open: 224, high: 226, low: 223, close: 225, volume: 80 },
    ]);

    const result = await provider.getHistory(
      "AAPL",
      new Date("2026-08-18"),
      new Date("2026-08-20")
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
      expect(result.data[0]!.timestamp.slice(0, 10)).toBe("2026-08-18");
      expect(result.data[2]!.timestamp.slice(0, 10)).toBe("2026-08-20");
    }
  });

  it("treats an empty historical array as an invalid ticker", async () => {
    mockFetchOnce(200, []);
    const result = await provider.getHistory("ZZZZZ", new Date("2026-01-01"), new Date("2026-01-31"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
  });

  it("treats a bare {symbol} object (no price rows) as an invalid ticker", async () => {
    mockFetchOnce(200, { symbol: "ZZZZZ" });
    const result = await provider.getHistory("ZZZZZ", new Date("2026-01-01"), new Date("2026-01-31"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
  });

  it("surfaces a network failure as PROVIDER_UNREACHABLE", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await provider.getQuote("AAPL");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNREACHABLE");
  });
});
