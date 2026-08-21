import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmpMacroDataProvider } from "./fmp-provider";

function mockFetchByUrl(responses: Record<string, { status: number; body: unknown }>) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key]! : { status: 404, body: {} };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    });
  }) as unknown as typeof fetch;
}

describe("FmpMacroDataProvider", () => {
  const provider = new FmpMacroDataProvider("test-key");

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("throws at construction time if no API key is provided", () => {
    expect(() => new FmpMacroDataProvider("")).toThrow(/FMP_API_KEY/);
  });

  it("fetches and labels GDP, CPI, unemployment, and treasury yield with full provenance", async () => {
    mockFetchByUrl({
      "economic-indicators": { status: 200, body: [{ date: "2026-06-01", value: 2.5 }] },
      "treasury-rates": { status: 200, body: [{ date: "2026-08-01", year10: 4.25 }] },
    });

    const result = await provider.getIndicators();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(4); // GDP, CPI, unemploymentRate, treasury10Year
      for (const indicator of result.data) {
        expect(indicator.source).toBeTruthy();
        expect(indicator.retrievedAt).toBeTruthy();
        expect(indicator.asOfDate).toBeTruthy();
      }
      const treasury = result.data.find((i) => i.name === "treasury10Year");
      expect(treasury?.value).toBe(4.25);
    }
  });

  it("returns partial results if only some indicators succeed", async () => {
    mockFetchByUrl({
      "economic-indicators": { status: 200, body: [{ date: "2026-06-01", value: 2.5 }] },
      "treasury-rates": { status: 402, body: {} }, // this one fails
    });

    const result = await provider.getIndicators();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.find((i) => i.name === "treasury10Year")).toBeUndefined();
    }
  });

  it("returns an error if every indicator fails the same way", async () => {
    mockFetchByUrl({
      "economic-indicators": { status: 402, body: {} },
      "treasury-rates": { status: 402, body: {} },
    });

    const result = await provider.getIndicators();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
  });

  it("maps HTTP 401 to a provider auth error", async () => {
    mockFetchByUrl({
      "economic-indicators": { status: 401, body: {} },
      "treasury-rates": { status: 401, body: {} },
    });
    const result = await provider.getIndicators();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_AUTH_ERROR");
  });

  it("surfaces a total network failure as an error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await provider.getIndicators();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNREACHABLE");
  });
});
