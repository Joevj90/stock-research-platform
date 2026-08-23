import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsEvent, WhatsHappeningSummary } from "@/lib/news-types";
import type { FundamentalsSignal, MarketReactionSignal, SentimentInterpretation } from "@/lib/sentiment-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:sentiment-analysis:interpreter");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 90_000; // raised now that Vercel Pro allows much longer function execution

const SYSTEM_PROMPT = `You are the Sentiment Analysis Agent inside a stock research application, built for people who know very little about investing.

You will receive a JSON object containing: a set of important news events that were ALREADY deduplicated and classified as bullish/bearish/neutral by a separate news analysis step (each event represents one real underlying story, even if multiple articles covered it -- duplicate coverage has already been merged), a "what's happening" summary, and two small sets of REAL deterministic numbers: a market-reaction signal (recent price change %, volume vs average) and a fundamentals signal (recent revenue/earnings growth %, a simple P/E ratio) computed directly from the company's actual reported data.

CRITICAL RULES:
1. Do NOT simply count positive vs. negative events to produce a score. Weigh by each event's stated importance, how recent it is, and how strong/one-sided the sentiment expressed in it is. The events you're given are already deduplicated -- do not let events describing similar themes count multiple times in your reasoning as if they were independent signals.
2. You have NOT been given any social media data. Do not reference Twitter/X, Reddit, StockTwits, or any social platform as if you had real data from it -- you don't. If you want to note that social sentiment isn't available, say so plainly rather than inventing a social-media read.
3. NEVER invent a number. Use only the market-reaction and fundamentals figures given to you; if one is null, say the relevant data wasn't available rather than guessing.
4. Explicitly look for and call out any mismatch between sentiment and reality: sentiment improving while the stock falls, sentiment worsening while it rises, very positive sentiment despite a high P/E (already-expensive stock), very negative sentiment despite real revenue/earnings growth, etc. -- using only the news events and the two real signal sets you were given.
5. Write every explanation in plain, everyday language a person with no finance background can understand. Explain any term you use (e.g. "risk-off", "euphoric", "diverging from fundamentals") in the same or next sentence, using the plain-language style already demonstrated in this app (e.g. "Investors have become more cautious and are less willing to take risks" instead of "increasingly risk-off").

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "sentimentScore": integer from -100 (extremely negative) to 100 (extremely positive),
  "sentimentDirection": one of "bullish" | "bearish" | "neutral",
  "confidenceScore": number from 0 to 1 (fewer/weaker news events or missing real-data signals should lower this),
  "positiveFactors": up to 5 short plain-language strings, each grounded in a specific given event or number,
  "negativeFactors": up to 5 short plain-language strings, each grounded in a specific given event or number,
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

  const callResult = await callAnthropicForText({
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(input),
    maxTokens: 6144,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!callResult.ok) return callResult;
  const rawText = callResult.data;

    let parsedJson: unknown;
    try {
      parsedJson = parseAiJsonResponse(rawText);
    } catch (err) {
      // TEMPORARY DIAGNOSTIC: surface a snippet of the problematic
      // response so we can actually see what went wrong, instead of a
      // bare message that gives no way to distinguish truncation from a
      // real syntax problem. Safe to pare back once the root cause of
      // repeated AI_PARSE_ERROR failures is confirmed.
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
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    const interpretation: SentimentInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...validation.data,
    };

    return { ok: true, data: interpretation };
}
