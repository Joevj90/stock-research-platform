import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MacroIndicator, MacroInterpretation } from "@/lib/macro-types";
import type { StockSnapshot } from "@/lib/types";

vi.mock("@/server/macro", () => ({
  getMacroIndicators: vi.fn(),
}));

vi.mock("@/server/market-data", () => ({
  getStockSnapshot: vi.fn(),
}));

vi.mock("./interpreter", () => ({
  interpretMacroEnvironment: vi.fn(),
}));

const { getMacroIndicators } = await import("@/server/macro");
const { getStockSnapshot } = await import("@/server/market-data");
const { interpretMacroEnvironment } = await import("./interpreter");
const { runMacroAnalysis } = await import("./service");

function indicator(): MacroIndicator {
  return {
    name: "CPI",
    label: "Inflation",
    value: 3.1,
    unit: "%",
    asOfDate: "2026-08-01T00:00:00.000Z",
    source: "FMP",
    url: "https://example.com",
    retrievedAt: new Date().toISOString(),
  };
}

function snapshot(): StockSnapshot {
  return {
    ticker: "JPM",
    companyName: "JPMorgan Chase",
    quote: {
      ticker: "JPM",
      price: 200,
      change: 1,
      changePercent: 0.5,
      dayHigh: 202,
      dayLow: 198,
      previousClose: 199,
      volume: 1_000_000,
      marketCap: 500_000_000_000,
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

const SAMPLE_INTERPRETATION: MacroInterpretation = {
  source: "ai",
  model: "claude-sonnet-5",
  generatedAt: "2026-08-20T00:00:00.000Z",
  macroScore: 20,
  overallMacroEnvironment: "favorable",
  confidenceScore: 0.7,
  positiveFactors: [],
  negativeFactors: [],
  mostImportantMacroFactor: "Interest rates",
  biggestMacroRisk: { whatCouldHappen: "x", whyItWouldMatter: "y", effect: "negative", significance: "medium" },
  importantMacroRisks: [
    { whatCouldHappen: "x", whyItWouldMatter: "y", effect: "negative", significance: "medium" },
    { whatCouldHappen: "a", whyItWouldMatter: "b", effect: "negative", significance: "low" },
  ],
  timeHorizon: "medium_term",
  overallConclusion: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runMacroAnalysis", () => {
  it("fetches indicators via the macro service, never a provider directly", async () => {
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [indicator()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runMacroAnalysis("JPM");

    expect(getMacroIndicators).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("passes the resolved company name to the interpreter", async () => {
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [indicator()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    await runMacroAnalysis("JPM");

    const call = (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.companyName).toBe("JPMorgan Chase");
  });

  it("proceeds with a null company name if the snapshot lookup fails, rather than failing outright", async () => {
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [indicator()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_TICKER", message: "bad" },
    });
    (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_INTERPRETATION });

    const result = await runMacroAnalysis("JPM");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.companyName).toBeNull();

    const call = (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.companyName).toBeNull();
  });

  it("propagates a macro-indicators error without calling the interpreter", async () => {
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_PLAN_REQUIRED", message: "needs upgrade" },
    });

    const result = await runMacroAnalysis("JPM");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_PLAN_REQUIRED");
    expect(interpretMacroEnvironment).not.toHaveBeenCalled();
  });

  it("propagates an AI interpretation error (e.g. AI_NOT_CONFIGURED)", async () => {
    (getMacroIndicators as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [indicator()] });
    (getStockSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: snapshot() });
    (interpretMacroEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await runMacroAnalysis("JPM");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("rejects an empty ticker before touching any service", async () => {
    const result = await runMacroAnalysis("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(getMacroIndicators).not.toHaveBeenCalled();
  });
});
