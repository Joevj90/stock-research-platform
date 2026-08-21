import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MacroInterpreterInput } from "./interpreter";
import type { MacroIndicator } from "@/lib/macro-types";

function indicator(name: string, value: number): MacroIndicator {
  return {
    name,
    label: name,
    value,
    unit: "%",
    asOfDate: "2026-08-01T00:00:00.000Z",
    source: "Financial Modeling Prep",
    url: "https://example.com",
    retrievedAt: new Date().toISOString(),
  };
}

const SAMPLE_INPUT: MacroInterpreterInput = {
  ticker: "JPM",
  companyName: "JPMorgan Chase",
  indicators: [indicator("treasury10Year", 4.3), indicator("CPI", 3.1)],
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

const VALID_FACTOR = {
  factor: "Interest rates",
  whatIsHappening: "x",
  whyItMattersToCompany: "y",
  effect: "positive",
  significance: "high",
  timeHorizon: "medium_term",
};

const VALID_RISK = { whatCouldHappen: "x", whyItWouldMatter: "y", effect: "negative", significance: "medium" };

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    macroScore: 30,
    overallMacroEnvironment: "favorable",
    confidenceScore: 0.7,
    positiveFactors: [VALID_FACTOR],
    negativeFactors: [],
    mostImportantMacroFactor: "Interest rates",
    biggestMacroRisk: VALID_RISK,
    importantMacroRisks: [VALID_RISK, VALID_RISK],
    timeHorizon: "medium_term",
    overallConclusion: "The environment is favorable for this bank.",
    ...overrides,
  };
}

describe("interpretMacroEnvironment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns AI_NOT_CONFIGURED without throwing when ANTHROPIC_API_KEY is unset", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("parses a valid, well-formed interpretation response", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload())));

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("ai");
      expect(result.data.overallMacroEnvironment).toBe("favorable");
    }
  });

  it("requires at least 2 importantMacroRisks per spec", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ importantMacroRisks: [VALID_RISK] }))));

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects more than 5 importantMacroRisks per spec", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    const sixRisks = Array(6).fill(VALID_RISK);
    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ importantMacroRisks: sixRisks }))));

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects an invalid overallMacroEnvironment enum value", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse(JSON.stringify(validPayload({ overallMacroEnvironment: "great" }))));

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("rejects non-JSON model output", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    mockAnthropicResponse(200, anthropicTextResponse("The economy looks fine for this company."));

    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
  });

  it("maps a network failure to AI_UNREACHABLE", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await interpretMacroEnvironment(SAMPLE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_UNREACHABLE");
  });

  it("sends the ticker, company name, and real indicators, and instructs against fabrication and generic reports", async () => {
    vi.doMock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));
    const { interpretMacroEnvironment } = await import("./interpreter");

    let capturedBody: string | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({ ok: true, status: 200, json: async () => anthropicTextResponse(JSON.stringify(validPayload())) });
    }) as unknown as typeof fetch;

    await interpretMacroEnvironment(SAMPLE_INPUT);

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.messages[0].content).toContain("JPMorgan Chase");
    expect(parsedBody.messages[0].content).toContain('"name":"treasury10Year"');
    expect(parsedBody.system.toLowerCase()).toContain("never fabricate");
    expect(parsedBody.system.toLowerCase()).toContain("generic economic report");
  });
});
