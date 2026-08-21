import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementInterpreterInput } from "./interpreter";
import type { CapitalAllocationSignal, InsiderActivitySummary } from "@/lib/management-types";

const FLAT_TREND = { direction: "flat" as const, latestValue: 100, priorValue: 100, changePct: 0 };

const SAMPLE_CAPITAL_ALLOCATION: CapitalAllocationSignal = {
  source: "calculated",
  dividendsPaidTrend: FLAT_TREND,
  totalDebtTrend: FLAT_TREND,
  cashTrend: FLAT_TREND,
  freeCashFlowTrend: FLAT_TREND,
  impliedSharesOutstandingTrend: FLAT_TREND,
};

const SAMPLE_INSIDER_SUMMARY: InsiderActivitySummary = {
  source: "calculated",
  transactionCount: 2,
  purchaseCount: 0,
  saleCount: 2,
  netSharesPurchased: -1000,
  mostRecentTransactionDate: "2026-08-01T00:00:00.000Z",
};

const SAMPLE_INPUT: ManagementInterpreterInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  capitalAllocation: SAMPLE_CAPITAL_ALLOCATION,
  insiderActivitySummary: SAMPLE_INSIDER_SUMMARY,
  recentInsiderTransactions: [],
};

function mockAnthropicResponse(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

function anthropicTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    managementScore: 30,
    overallAssessment: "good",
    confidenceScore: 0.6,
    whatManagementIsDoingWell: [{ factor: "Stable finances", explanation: "x" }],
    managementConcerns: [],
    trackRecordVsGuidance: "This analysis does not have access to verified historical guidance data, so we cannot compare past predictions to results.",
    capitalAllocationAssessment: "Management appears to be managing money steadily.",
    insiderActivityAssessment: "Some insider selling occurred, which is not automatically a negative sign.",
    managementCredibility: "medium",
    managementCredibilityExplanation: "Limited data is available to fully assess credibility.",
    overallConclusion: "Overall, management appears to be doing an adequate job.",
    ...overrides,
  };
}

describe("interpretManagement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretManagement } = await import("./interpreter");

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.overallAssessment).toBe("good");
    }
  });

  it("rejects an invalid overallAssessment enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ overallAssessment: "excellent" }))));

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid managementCredibility enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ managementCredibility: "very_high" }))));

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects a score outside -100..100", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ managementScore: 500 }))));

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("Management seems to be doing fine."));

    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretManagement(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("instructs the model to never fabricate guidance statements and to treat insider selling neutrally", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretManagement(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.system).toContain("NO source of historical management guidance");
    expect(parsedBody.system.toLowerCase()).toContain("not automatically bearish");
    expect(parsedBody.messages[0].content).toContain('"saleCount":2');
  });

  it("accepts a trackRecordVsGuidance value that plainly states unavailability rather than a specific figure", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretManagement } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));
    const result = await interpretManagement(SAMPLE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.trackRecordVsGuidance.toLowerCase()).toContain("does not have access");
    }
  });
});
