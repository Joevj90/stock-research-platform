import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    savedAnalysis: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("./comparison-interpreter", () => ({
  interpretComparison: vi.fn(),
}));

const { prisma } = await import("@/server/db/client");
const { interpretComparison } = await import("./comparison-interpreter");
const { getAnalysisHistory, compareTwoAnalyses, getSavedAnalysisReport } = await import("./history-service");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "sa_1",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    analysisDate: new Date("2026-01-01T00:00:00.000Z"),
    priceAtAnalysis: 200,
    rating: "buy",
    confidenceScore: 70,
    bearPrice: 150,
    basePrice: 210,
    bullPrice: 280,
    expectedPrice: 220,
    expectedReturnPct: 10,
    bearProbabilityPct: 20,
    baseProbabilityPct: 50,
    bullProbabilityPct: 30,
    valuationConclusion: "x",
    sentimentConclusion: "x",
    macroConclusion: "x",
    competitorConclusion: "x",
    managementConclusion: "x",
    committeeConclusion: "x",
    devilsAdvocateConclusion: "x",
    bottomLine: "x",
    majorAssumptions: "[]",
    majorRisks: "[]",
    majorCatalysts: "[]",
    keyNewsFindings: "[]",
    fullReportJson: JSON.stringify({ ticker: "AAPL" }),
    ...overrides,
  };
}

const SAMPLE_NARRATIVE = {
  whatChanged: [
    { whatChanged: "x", whyItMatters: "y", direction: "improved" },
    { whatChanged: "a", whyItMatters: "b", direction: "no_effect" },
    { whatChanged: "c", whyItMatters: "d", direction: "weakened" },
  ],
  thesisChangeLevel: "slightly_changed",
  thesisChangeExplanation: "x",
  ratingChangeExplanation: "x",
  priceRelatedChanges: [],
  businessRelatedChanges: [],
  whatImproved: [],
  whatGotWorse: [],
  whatStayedTheSame: [],
  whyOpinionChanged: "x",
  finalBottomLine: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalysisHistory", () => {
  it("returns all saved analyses, newest first, with no comparison when only 0 or 1 exist", async () => {
    (prisma.savedAnalysis.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row()]);

    const result = await getAnalysisHistory("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.analyses).toHaveLength(1);
      expect(result.data.latestComparison).toBeNull();
    }
    // No AI call should have been made -- viewing history with nothing to compare must be free.
    expect(interpretComparison).not.toHaveBeenCalled();
  });

  it("generates a comparison between the two most recent analyses when 2+ exist", async () => {
    (prisma.savedAnalysis.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "sa_2", analysisDate: new Date("2026-03-01T00:00:00.000Z") }),
      row({ id: "sa_1", analysisDate: new Date("2026-01-01T00:00:00.000Z") }),
    ]);
    (interpretComparison as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_NARRATIVE });

    const result = await getAnalysisHistory("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.latestComparison).not.toBeNull();
      expect(result.data.latestComparison?.current.id).toBe("sa_2");
      expect(result.data.latestComparison?.previous.id).toBe("sa_1");
    }
  });

  it("still returns the real history even if the comparison AI call fails -- history is never hidden behind a comparison failure", async () => {
    (prisma.savedAnalysis.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ id: "sa_2", analysisDate: new Date("2026-03-01T00:00:00.000Z") }),
      row({ id: "sa_1", analysisDate: new Date("2026-01-01T00:00:00.000Z") }),
    ]);
    (interpretComparison as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "no key" },
    });

    const result = await getAnalysisHistory("AAPL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.analyses).toHaveLength(2);
      expect(result.data.latestComparison).toBeNull();
    }
  });

  it("rejects an empty ticker before touching the database", async () => {
    const result = await getAnalysisHistory("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_TICKER");
    expect(prisma.savedAnalysis.findMany).not.toHaveBeenCalled();
  });
});

describe("compareTwoAnalyses", () => {
  it("compares two specific analyses by id", async () => {
    (prisma.savedAnalysis.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(row({ id: "sa_2" }))
      .mockResolvedValueOnce(row({ id: "sa_1" }));
    (interpretComparison as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: SAMPLE_NARRATIVE });

    const result = await compareTwoAnalyses("sa_2", "sa_1");
    expect(result.ok).toBe(true);
  });

  it("returns an error if either analysis cannot be found", async () => {
    (prisma.savedAnalysis.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null).mockResolvedValueOnce(row());

    const result = await compareTwoAnalyses("missing", "sa_1");
    expect(result.ok).toBe(false);
  });
});

describe("getSavedAnalysisReport", () => {
  it("returns the full verbatim historical report", async () => {
    (prisma.savedAnalysis.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(row());

    const result = await getSavedAnalysisReport("sa_1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.fullReport).toEqual({ ticker: "AAPL" });
  });

  it("returns an error when the analysis cannot be found", async () => {
    (prisma.savedAnalysis.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getSavedAnalysisReport("missing");
    expect(result.ok).toBe(false);
  });
});
