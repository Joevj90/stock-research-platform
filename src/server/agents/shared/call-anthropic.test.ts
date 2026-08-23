import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/config/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));

const { callAnthropicForText } = await import("./call-anthropic");

const SAMPLE_PARAMS = {
  model: "claude-sonnet-5",
  systemPrompt: "system",
  userContent: "user content",
  maxTokens: 4096,
  timeoutMs: 30_000,
};

function mockResponseOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("callAnthropicForText", () => {
  it("returns the text on a clean successful call, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponseOnce(200, textResponse("hello")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result).toEqual({ ok: true, data: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds when the first response has no text content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponseOnce(200, { content: [] })) // empty -- transient-looking
      .mockResolvedValueOnce(mockResponseOnce(200, textResponse("recovered on retry")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result).toEqual({ ok: true, data: "recovered on retry" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports AI_PARSE_ERROR (not an internal-only code) if BOTH attempts return no text content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponseOnce(200, { content: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_PARSE_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network failure and succeeds on the second attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(mockResponseOnce(200, textResponse("recovered")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result).toEqual({ ok: true, data: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a provider 5xx error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponseOnce(503, {}))
      .mockResolvedValueOnce(mockResponseOnce(200, textResponse("recovered")));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result).toEqual({ ok: true, data: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on an authentication error -- retrying won't fix a bad API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponseOnce(401, {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_AUTH_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on a rate-limit error -- immediate retry would likely hit the same limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponseOnce(429, {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await callAnthropicForText(SAMPLE_PARAMS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
