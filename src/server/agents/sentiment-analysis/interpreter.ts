import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsEvent, WhatsHappeningSummary } from "@/lib/news-types";
import type { FundamentalsSignal, MarketReactionSignal, SentimentInterpretation } from "@/lib/sentiment-types";

const log = logger.child("agents:sentiment-analysis:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Sentiment Analysis Agent inside a stock research application, built for people who know very little about investing.

You will receive a JSON object containing: a set of important news events that were ALREADY deduplicated and classified as bullish/bearish/neutral by a separate news analysis step (each event represents one real underlying story, even if multiple articles covered it -- duplicate coverage has already been merged), a "what's happening" summary, and two small sets of REAL deterministic numbers: a market-reaction signal (recent price change %, volume vs average) and a fundamentals signal (recent revenue/earnings growth %, a simple P/E ratio) computed directly from the company's actual reported data.

CRITICAL RULES:
1. Do NOT simply count positive vs. negative events to produce a score. Weigh by each event's stated importance, how recent it is, and how strong/one-sided the sentiment expressed in it is. The events you're given are already deduplicated -- do not let events describing similar themes count multiple times in your reasoning as if they were independent signals.
2. You have NOT been given any social media data. Do not reference Twitter/X, Reddit, StockTwits, or any social platform as if you had real data from it -- you don't. If you want to note that social sentiment isn't available, say so plainly rather than inventing a social-media read.
3. NEVER invent a number. Use only the market-reaction and fundamentals figures given to you; if one is null, say the relevant data wasn't available rather than guessing.
4. Explicitly look for and call out any mismatch between sentiment and reality: sentiment improving while the stock falls, sentiment worsening while it rises, very positive sentiment despite a high P/E (already-expensive stock), very negative sentiment despite real revenue/earnings growth, etc. -- using only the news events and the two real signal sets you were given.
5. Write every explanation in plain, everyday language a person with no finance background can understand. Explain any term you use (e.g. "risk-off", "euphoric", "diverging from fundamentals") in the same or next sentence, using the plain-language style already demonstrated in this app (e.g. "Investors have become more cautious and are less willing to take risks" instead of "increasingly risk-off").

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "sentimentScore": integer from -100 (extremely negative) to 100 (extremely positive),
  "sentimentDirection": one of "bullish" | "bearish" | "neutral",
  "confidenceScore": number from 0 to 1 (fewer/weaker news events or missing real-data signals should lower this),
  "positiveFactors": array of short plain-language strings, each grounded in a specific given event or number,
  "negativeFactors": array of short plain-language strings, each grounded in a specific given event or number,
  "majorSentimentDrivers": array of short plain-language strings naming the 2-4 biggest drivers of the current sentiment,
  "sentimentTrend": one of "strongly_improving" | "improving" | "stable" | "deteriorating" | "strongly_deteriorating",
  "sentimentTrendExplanation": "plain language explanation of why the trend looks this way",
  "marketReaction": { "whatIsHappening": string, "why": string, "whyItMatters": string },
  "sentimentVsFundamentals": { "whatIsHappening": string, "why": string, "whyItMatters": string },
  "sentimentVsValuation": { "whatIsHappening": string, "why": string, "whyItMatters": string },
  "overallConclusion": "3-5 plain-language sentences summarizing the overall sentiment picture"
}

If given real-data signals are null (e.g. not enough price history), say plainly in the relevant section that this specific data wasn't available -- do not fabricate a substitute number.`;

const AssessmentSchema = z.object({
  whatIsHappening: z.string().min(1),
  why: z.string().min(1),
  whyItMatters: z.string().min(1),
});

const InterpretationSchema = z.object({
  sentimentScore: z.number().min(-100).max(100),
  sentimentDirection: z.enum(["bullish", "bearish", "neutral"]),
  confidenceScore: z.number().min(0).max(1),
  positiveFactors: z.array(z.string()),
  negativeFactors: z.array(z.string()),
  majorSentimentDrivers: z.array(z.string()),
  sentimentTrend: z.enum(["strongly_improving", "improving", "stable", "deteriorating", "strongly_deteriorating"]),
  sentimentTrendExplanation: z.string().min(1),
  marketReaction: AssessmentSchema,
  sentimentVsFundamentals: AssessmentSchema,
  sentimentVsValuation: AssessmentSchema,
  overallConclusion: z.string().min(1),
});

export interface SentimentInterpreterInput {
  whatsHappening: WhatsHappeningSummary;
  newsEvents: NewsEvent[];
  marketReaction: MarketReactionSignal;
  fundamentalsSignal: FundamentalsSignal;
}

/**
 * Sends already-classified news events (from Step 7) plus two small real
 * deterministic signal sets to Claude for synthesis into an overall
 * sentiment reading. Never throws; returns a typed error rather than a
 * fabricated fallback if the key is missing, the request fails, or the
 * response doesn't match the required schema.
 */
export async function interpretSentiment(
  input: SentimentInterpreterInput
): Promise<Result<SentimentInterpretation>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI interpretation requires ANTHROPIC_API_KEY to be set.",
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
        max_tokens: 6144, // raised from 4096 -- real, detailed data produces longer responses than the mock data this was originally tuned against
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(input) }],
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
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response contained no text content." } };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFences(rawText));
    } catch {
      log.error("Failed to parse AI response as JSON", { rawText: rawText.slice(0, 500) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response was not valid JSON." } };
    }

    const validation = InterpretationSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", {
        issues: validation.error.issues.map((i) => i.message),
      });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    const interpretation: SentimentInterpretation = {
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

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
}
