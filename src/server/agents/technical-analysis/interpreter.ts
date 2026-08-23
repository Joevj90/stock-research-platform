import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CalculatedTechnicalMetrics, TechnicalInterpretation } from "./types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:technical-analysis:interpreter");

// Balanced default model for a moderate-complexity structured-interpretation
// task — see the chat writeup for why this model was chosen.
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 45_000; // raised from 30s for the same reason

const SYSTEM_PROMPT = `You are the interpretation layer of a Technical Analysis Agent inside a stock research application.

You will receive a JSON object of technical indicators that were already calculated deterministically in code from real historical price data (SMA/EMA, RSI, MACD, Bollinger Bands, ATR, volume trend, volatility, momentum, support/resistance levels).

Your ONLY job is to interpret these already-computed numbers. Do not recompute, re-derive, estimate, or second-guess any numeric indicator — treat every number given to you as ground truth. Do not invent price levels, indicator values, or data points that are not present in the input.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "trend": one of "strong_uptrend" | "uptrend" | "sideways" | "downtrend" | "strong_downtrend",
  "momentum": one of "overbought" | "bullish" | "neutral" | "bearish" | "oversold",
  "bullishSignals": up to 5 short strings, each citing a specific given metric (e.g. "RSI at 28 indicates oversold conditions"),
  "bearishSignals": up to 5 short strings, each citing a specific given metric,
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

  const callResult = await callAnthropicForText({
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(metrics),
    maxTokens: 2048,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!callResult.ok) return callResult;
  const rawText = callResult.data;

  let parsedJson: unknown;
  try {
    parsedJson = parseAiJsonResponse(rawText);
  } catch (err) {
    // TEMPORARY DIAGNOSTIC: see the identical comment in other
    // interpreters' catch blocks for why this exists.
    const diag =
      err instanceof AiJsonParseError
        ? ` [diag: ${err.message}${err.snippetAtFailure ? ` | at failure: ...${err.snippetAtFailure}...` : ` | start: "${err.snippetStart.slice(0, 100)}" end: "${err.snippetEnd.slice(-100)}"`}]`
        : ``;
    log.error("Failed to parse AI response as JSON", {
      rawTextLength: rawText.length,
      rawTextStart: rawText.slice(0, 300),
      rawTextEnd: rawText.slice(-300),
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: { code: "AI_PARSE_ERROR", message: `AI response was not valid JSON.${diag}` },
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
}
