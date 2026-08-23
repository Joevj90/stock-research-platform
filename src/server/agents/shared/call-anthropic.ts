import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";

const log = logger.child("agents:shared:call-anthropic");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicCallParams {
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * Calls the Anthropic Messages API and returns the raw text response.
 * Every interpreter in this app used to duplicate this exact
 * fetch/status-code/text-extraction logic independently -- centralized
 * here both to remove that duplication and, more importantly, to add
 * ONE automatic retry for failures that look transient (a genuinely
 * empty response, a network blip, a timeout, or a provider-side 5xx) --
 * a compounding real-world concern once a single request chains through
 * as many as 16 of these calls (the Final Report). This does NOT retry
 * on auth errors, rate limits, or "not configured" -- those won't be
 * fixed by trying again. JSON parsing and schema validation remain each
 * interpreter's own responsibility, since those are agent-specific.
 */
export async function callAnthropicForText(params: AnthropicCallParams): Promise<Result<string>> {
  const first = await attemptCall(params);
  if (first.ok) return first;

  const retryableCodes = ["AI_TIMEOUT", "AI_UNREACHABLE", "AI_PROVIDER_ERROR", "AI_EMPTY_RESPONSE"];
  if (!retryableCodes.includes(first.error.code)) return normalizeErrorCode(first);

  log.warn("retrying Anthropic API call once after a transient-looking failure", { error: first.error });
  const second = await attemptCall(params);
  return normalizeErrorCode(second);
}

/** AI_EMPTY_RESPONSE is an internal-only code used to decide whether to
 * retry; external callers have always seen "no text content" as
 * AI_PARSE_ERROR, so it's mapped back before being returned. */
function normalizeErrorCode(result: Result<string>): Result<string> {
  if (result.ok) return result;
  if (result.error.code === "AI_EMPTY_RESPONSE") {
    return { ok: false, error: { code: "AI_PARSE_ERROR", message: result.error.message } };
  }
  return result;
}

async function attemptCall(params: AnthropicCallParams): Promise<Result<string>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "AI interpretation requires ANTHROPIC_API_KEY to be set." },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.systemPrompt,
        messages: [{ role: "user", content: params.userContent }],
      }),
    });

    if (res.status === 401 || res.status === 403) {
      log.error("Anthropic API authentication failed", { status: res.status });
      return { ok: false, error: { code: "AI_AUTH_ERROR", message: "AI provider rejected the API key." } };
    }
    if (res.status === 429) {
      return { ok: false, error: { code: "AI_RATE_LIMITED", message: "AI provider rate limit exceeded." } };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("Anthropic API request failed", { status: res.status, body: body.slice(0, 500) });
      return { ok: false, error: { code: "AI_PROVIDER_ERROR", message: `AI provider returned ${res.status}.` } };
    }

    const json = (await res.json()) as AnthropicMessageResponse;
    const rawText = json.content?.find((b) => b.type === "text")?.text;
    if (!rawText) {
      return { ok: false, error: { code: "AI_EMPTY_RESPONSE", message: "AI response contained no text content." } };
    }

    return { ok: true, data: rawText };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    log.error("Anthropic API request threw", { error: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      error: {
        code: isAbort ? "AI_TIMEOUT" : "AI_UNREACHABLE",
        message: isAbort ? "AI provider timed out." : "Could not reach the AI provider.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
}
