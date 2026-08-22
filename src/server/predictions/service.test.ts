import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastResult, ScenarioOutcome } from "@/lib/forecast-types";

vi.mock("@/server/db/client", () => ({
  prisma: {
    stock: { upsert: vi.fn() },
    prediction: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/server/market-data", () => ({
  getQuote: vi.fn(),
}));

const { prisma } = await import("@/server/db/client");
const { getQuote } = await import("@/server/market-data");
const { recordPredictionsFromForecast, evaluatePendingPredictions, getPredictionHistory, getAccuracyDashboard } =
  await import("./service");

const STOCK_ROW = { id: "stock_1", ticker: "AAPL" };

function scenario(overrides: Partial<ScenarioOutcome> = {}): ScenarioOutcome {
  return {
    scenario: "base",
    explanation: "x",
    estimatedFinancialOutcome: "x",
    priceTarget: 210,
    expectedReturnPct: 5,
    probabilityPct: 50,
    mainReasons: [],
    keyRisks: ["Slowing growth"],
    ...overrides,
  };
}

function forecastResult(overrides: { horizonSupport?: boolean } = {}): ForecastResult {
  const supports = overrides.horizonSupport ?? true;
  const horizon = {
    horizon: "3_month" as const,
    dataSupportsThisHorizon: supports,
    limitationNote: supports ? null : "Not enough data.",
    bear: scenario({ scenario: "bear", priceTarget: 150, probabilityPct: 20 }),
    base: scenario(),
    bull: scenario({ scenario: "bull", priceTarget: 280, probabilityPct: 30 }),
    expectedPrice: 215,
    expectedReturnPct: 20,
    mostLikelyScenario: "base" as const,
  };
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    currentPrice: 200,
    generatedAt: new Date().toISOString(),
    inputsUsed: {
      technical: false,
      fundamental: false,
      valuation: false,
      sentiment: false,
      macro: false,
      competitor: false,
      management: false,
      risk: false,
    },
    interpretation: {
      source: "ai",
      model: "claude-sonnet-5",
      generatedAt: new Date().toISOString(),
      horizons: [horizon, { ...horizon, horizon: "6_month" }, { ...horizon, horizon: "12_month" }],
      keyCatalysts: [],
      keyRisksSummary: [],
      confidenceScore: 75,
      confidenceExplanation: "x",
      biggestOptimismReason: "x",
      biggestRiskReason: "x",
      assumptions: [{ assumption: "Growth continues", explanation: "x" }],
      overallConclusion: "x",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.stock.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(STOCK_ROW);
});

describe("recordPredictionsFromForecast", () => {
  it("creates one prediction per horizon that the forecast said was reliable", async () => {
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.prediction.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordPredictionsFromForecast("AAPL", forecastResult());

    expect(prisma.prediction.create).toHaveBeenCalledTimes(3);
  });

  it("skips a horizon the forecast marked as unreliable", async () => {
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.prediction.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordPredictionsFromForecast("AAPL", forecastResult({ horizonSupport: false }));

    expect(prisma.prediction.create).not.toHaveBeenCalled();
  });

  it("skips recording when a recent duplicate for the same ticker+horizon already exists", async () => {
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "existing" });

    await recordPredictionsFromForecast("AAPL", forecastResult());

    expect(prisma.prediction.create).not.toHaveBeenCalled();
  });

  it("derives the 5-way rating deterministically from real expected return and confidence", async () => {
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.prediction.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordPredictionsFromForecast("AAPL", forecastResult()); // expectedReturnPct 20, confidence 75

    const createCall = (prisma.prediction.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.data.aiRating).toBe("strong_bullish");
    expect(createCall.data.bearPrice).toBe(150);
    expect(createCall.data.majorRisks).toBe(JSON.stringify(["Slowing growth"]));
  });

  it("never throws, even if the database write fails -- recording must not break the user-facing forecast", async () => {
    (prisma.prediction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.prediction.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));

    await expect(recordPredictionsFromForecast("AAPL", forecastResult())).resolves.toBeUndefined();
  });
});

describe("evaluatePendingPredictions", () => {
  function duePrediction(overrides: Record<string, unknown> = {}) {
    return {
      id: "pred_1",
      ticker: "AAPL",
      priceAtPrediction: 100,
      bearPrice: 90,
      basePrice: 110,
      bullPrice: 130,
      expectedPrice: 112,
      expectedReturnPct: 12,
      evaluationDueDate: new Date(Date.now() - 1000), // already due
      ...overrides,
    };
  }

  it("fetches the real current price and fills in ONLY the evaluation fields, never touching original fields", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([duePrediction()]);
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { price: 108 } });
    (prisma.prediction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await evaluatePendingPredictions();

    const updateCall = (prisma.prediction.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const writtenFields = Object.keys(updateCall.data);
    expect(writtenFields).toEqual(
      expect.arrayContaining([
        "actualPrice",
        "evaluatedAt",
        "actualReturnPct",
        "predictionErrorAbs",
        "predictionErrorPct",
        "directionCorrect",
        "rangeOutcome",
      ])
    );
    // Never includes any original prediction field.
    expect(writtenFields).not.toContain("priceAtPrediction");
    expect(writtenFields).not.toContain("bearPrice");
    expect(writtenFields).not.toContain("expectedPrice");
  });

  it("computes the actual return and direction correctly from a real fetched price", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([duePrediction()]);
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { price: 108 } });
    (prisma.prediction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await evaluatePendingPredictions();

    const updateCall = (prisma.prediction.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.actualReturnPct).toBeCloseTo(8, 5); // (108-100)/100*100
    expect(updateCall.data.directionCorrect).toBe(true); // both predicted (12%) and actual (8%) are "up"
  });

  it("skips (does not update) a prediction whose current price could not be fetched", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([duePrediction()]);
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "PROVIDER_UNREACHABLE", message: "x" },
    });

    await evaluatePendingPredictions();

    expect(prisma.prediction.update).not.toHaveBeenCalled();
  });

  it("does not evaluate a prediction whose due date has not actually passed (defensive re-check)", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      duePrediction({ evaluationDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) }), // 30 days from now
    ]);
    (getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: { price: 108 } });

    await evaluatePendingPredictions();

    expect(prisma.prediction.update).not.toHaveBeenCalled();
  });
});

describe("getPredictionHistory", () => {
  it("evaluates pending predictions before returning history", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await getPredictionHistory("AAPL");

    // findMany is called at least once for the evaluation pass and once for the history query.
    expect(prisma.prediction.findMany).toHaveBeenCalled();
  });

  it("rejects an empty ticker before touching the database", async () => {
    const result = await getPredictionHistory("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
  });
});

describe("getAccuracyDashboard", () => {
  it("evaluates pending predictions and builds a dashboard from real stored records", async () => {
    (prisma.prediction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getAccuracyDashboard();

    expect(result.totalPredictions).toBe(0);
    expect(result.overallDirectionAccuracyPct).toBeNull();
  });
});
