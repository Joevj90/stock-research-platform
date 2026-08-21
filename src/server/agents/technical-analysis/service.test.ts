import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceBar } from "@/lib/types";
import type { TechnicalInterpretation } from "./types";

vi.mock("@/server/market-data", () => ({
  getHistoricalPrices: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretTechnicalMetrics: vi.fn(),
}));

const { getHistoricalPrices } = await import("@/server/market-data");
const { interpretTechnicalMetrics } = await import("./interpreter");
const { runTechnicalAnalysis } = await import("./service");

function makeBars(count: number): PriceBar[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(2025, 0, 1 + i).toISOString(),
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1_000_000,
  }));
}

const SAMPLE_INTERPRETATION: TechnicalInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  trend: "uptrend",
  momentum: "bullish",
  bullishSignals: ["Price above SMA20"],
  bearishSignals: [],
  technicalScore: 40,
  explanation: "Consistent upward drift with healthy momentum.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTechnicalAnalysis", () => {
  it("fetches bars via the market-data service, never a provider directly", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: makeBars(250),
    });
    (interpretTechnicalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    const result = await runTechnicalAnalysis("AAPL", "1Y");

    expect(getHistoricalPrices).toHaveBeenCalledWith("AAPL", "1Y");
    expect(result.ok).toBe(true);
  });

  it("returns calculated and interpretation as separate, clearly-sourced objects", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: makeBars(250),
    });
    (interpretTechnicalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    const result = await runTechnicalAnalysis("AAPL", "1Y");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.calculated.source).toBe("calculated");
      expect(result.data.interpretation.source).toBe("ai");
      expect(result.data.calculated).not.toHaveProperty("trend");
      expect(result.data.interpretation).not.toHaveProperty("sma20");
    }
  });

  it("propagates a market-data error without calling the interpreter", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad ticker" },
    });

    const result = await runTechnicalAnalysis("ZZZZZ", "1Y");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TICKER");
    expect(interpretTechnicalMetrics).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_DATA when no bars are returned, without calling the interpreter", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] });

    const result = await runTechnicalAnalysis("AAPL", "1Y");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INSUFFICIENT_DATA");
    expect(interpretTechnicalMetrics).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED) after calculation still ran", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: makeBars(250),
    });
    (interpretTechnicalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runTechnicalAnalysis("AAPL", "1Y");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
    expect(interpretTechnicalMetrics).toHaveBeenCalled();
  });

  it("defaults to the 1Y period when none is given", async () => {
    (getHistoricalPrices as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: makeBars(250),
    });
    (interpretTechnicalMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: SAMPLE_INTERPRETATION,
    });

    await runTechnicalAnalysis("AAPL");

    expect(getHistoricalPrices).toHaveBeenCalledWith("AAPL", "1Y");
  });

  it("rejects an empty ticker before touching the market-data service", async () => {
    const result = await runTechnicalAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getHistoricalPrices).not.toHaveBeenCalled();
  });
});
