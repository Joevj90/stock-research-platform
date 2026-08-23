import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CalculatedTechnicalMetrics, TechnicalInterpretation } from "./types";
import { parseAiJsonResponse } from "@/server/agents/shared/parse-ai-json";

const log = logger.child("agents:technical-analysis:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Balanced default model for a moderate-complexity structured-interpretation
// task — see the chat writeup for why this model was chosen.
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 45_000; // raised from 30s for the same reason

const SYSTEM_PROMPT = `You are the interpretation layer of a Technical Analysis Agent inside a stock research application.

You will receive a JSON object of technical indicators that were already calculated deterministically in code from real historical price data (SMA/EMA, RSI, MACD, Bollinger Bands, ATR, volume trend, volatility, momentum, support/resistance levels).

Your ONLY job is to interpret these already-computed numbers. Do not recompute, re-derive, estimate, or second-guess any numeric indicator — treat every number given to you as ground truth. Do not invent price levels, indicator values, or data points that are not present in the input.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "trend": one of "strong_uptrend" | "uptrend" | "sideways" | "downtrend" | "strong_downtrend",
  "momentum": one of "overbought" | "bullish" | "neutral" | "bearish" | "oversold",
  "bullishSignals": array of short strings, each citing a specific given metric (e.g. "RSI at 28 indicates oversold conditions"),
  "bearishSignals": array of short strings, each citing a specific given metric,
  "technicalScore": integer from -100 (strongly bearish) to 100 (strongly bullish),
  "explanation": a 2-4 sentence plain-English synthesis referencing the specific calculated values you were given
}

If a given metric is null (not enough historical data), do not fabricate a value for it and do not cite it in a signal — simply work with the metrics that are available. If most metrics are null, say so plainly in the explanation and keep the technicalScore near 0.`;

const InterpretationSchema = z.object({
  trend: z.enum(["strong_uptrend", "uptrend", "sideways", "downtrend", "strong_downtrend"]),
  momentum: z.enum(["overbought", "bullish", "neutral", "bearish", "oversold"]),
  bullishSignals: z.array(z.string()),
  bearishSignals: z.array(z.string()),
  technicalScore: z.number().min(-100).max(100),
  explanation: z.string().min(1),
});

/**
 * Sends the already-calculated metrics to Claude for interpretation only.
 * Returns a typed error (never throws, never silently fabricates a
 * fallback interpretation) if the API key is missing, the request fails,
 * or the model's response doesn't match the required schema.
 */
export async function interpretTechnicalMetrics(
  metrics: CalculatedTechnicalMetrics
): Promise<Result<TechnicalInterpretation>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message:
          "AI interpretation requires ANTHROPIC_API_KEY to be set. Calculated metrics are still " +
          "available without it — see the /api/technical-analysis response's `calculated` field.",
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(metrics) }],
      }),
    });

    if (res.status === 401 || res.status === 403) {
      log.error("Anthropic API authentication failed", { status: res.status });
      return {
        ok: false,
        error: { code: "AI_AUTH_ERROR", message: "AI provider rejected the API key." },
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: { code: "AI_RATE_LIMITED", message: "AI provider rate limit exceeded." },
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("Anthropic API request failed", { status: res.status, body: body.slice(0, 500) });
      return {
        ok: false,
        error: { code: "AI_PROVIDER_ERROR", message: `AI provider returned ${res.status}.` },
      };
    }

    const json = (await res.json()) as AnthropicMessageResponse;
    const rawText = json.content?.find((b) => b.type === "text")?.text;
    if (!rawText) {
      return {
        ok: false,
        error: { code: "AI_PARSE_ERROR", message: "AI response contained no text content." },
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = parseAiJsonResponse(rawText);
    } catch {
      log.error("Failed to parse AI response as JSON", { rawText: rawText.slice(0, 500) });
      return {
        ok: false,
        error: { code: "AI_PARSE_ERROR", message: "AI response was not valid JSON." },
      };
    }

    const validation = InterpretationSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", {
        issues: validation.error.issues.map((i) => i.message),
      });
      return {
        ok: false,
        error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." },
      };
    }

    const interpretation: TechnicalInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...validation.data,
    };

    return { ok: true, data: interpretation };
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
