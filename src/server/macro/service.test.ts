import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MacroIndicator } from "@/lib/macro-types";

vi.mock("./provider", () => ({
  macroDataProvider: { id: "mock", isMock: true, getIndicators: vi.fn() },
}));

const { macroDataProvider } = await import("./provider");
const { getMacroIndicators, __resetMacroCacheForTests } = await import("./service");

function indicator(name: string, value: number): MacroIndicator {
  return {
    name,
    label: name,
    value,
    unit: "%",
    asOfDate: new Date().toISOString(),
    source: "Mock",
    url: null,
    retrievedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetMacroCacheForTests();
});

describe("getMacroIndicators", () => {
  it("calls the provider on a cache miss", async () => {
    (macroDataProvider.getIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [indicator("GDP", 2.5)],
    });

    const result = await getMacroIndicators();
    expect(macroDataProvider.getIndicators).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("serves from the in-memory cache on a second call within the TTL", async () => {
    (macroDataProvider.getIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [indicator("GDP", 2.5)],
    });

    await getMacroIndicators();
    await getMacroIndicators();

    expect(macroDataProvider.getIndicators).toHaveBeenCalledTimes(1);
  });

  it("propagates a provider error without caching it", async () => {
    (macroDataProvider.getIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await getMacroIndicators();
    expect(result.ok).toBe(false);

    // A subsequent successful call should still hit the provider (nothing bad was cached).
    (macroDataProvider.getIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [indicator("GDP", 2.5)],
    });
    const result2 = await getMacroIndicators();
    expect(result2.ok).toBe(true);
    expect(macroDataProvider.getIndicators).toHaveBeenCalledTimes(2);
  });
});
