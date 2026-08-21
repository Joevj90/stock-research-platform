import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmpNewsProvider } from "./fmp-provider";

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const SAMPLE_ROW = {
  symbol: "AAPL",
  publishedDate: "2026-08-20T14:00:00.000Z",
  title: "Apple announces new product",
  url: "https://example.com/apple-news-1",
  site: "Reuters",
  text: "A short summary of the article.",
};

describe("FmpNewsProvider", () => {
  const provider = new FmpNewsProvider("test-key");

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("throws at construction time if no API key is provided", () => {
    expect(() => new FmpNewsProvider("")).toThrow(/FMP_API_KEY/);
  });

  it("rejects malformed tickers before calling the network", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await provider.getCompanyNews("bad ticker!!", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses a successful response into the app's NewsArticle shape", async () => {
    mockFetchOnce(200, [SAMPLE_ROW]);

    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        headline: "Apple announces new product",
        url: "https://example.com/apple-news-1",
        source: "Reuters",
        ticker: "AAPL",
        summary: "A short summary of the article.",
      });
    }
  });

  it("filters out rows missing required fields rather than crashing", async () => {
    mockFetchOnce(200, [SAMPLE_ROW, { symbol: "AAPL", title: "Missing url and date" }]);

    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it("returns an empty array (not an error) when there is no news", async () => {
    mockFetchOnce(200, []);
    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("maps HTTP 402 to PROVIDER_PLAN_REQUIRED", async () => {
    mockFetchOnce(402, {});
    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
  });

  it("maps HTTP 401 to a provider auth error", async () => {
    mockFetchOnce(401, {});
    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_AUTH_ERROR");
  });

  it("maps HTTP 429 to a rate-limit error", async () => {
    mockFetchOnce(429, {});
    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_RATE_LIMITED");
  });

  it("surfaces a network failure as PROVIDER_UNREACHABLE", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await provider.getCompanyNews("AAPL", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNREACHABLE");
  });
});
