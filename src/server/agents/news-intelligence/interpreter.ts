import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsArticle, NewsIntelligenceInterpretation } from "@/lib/news-types";

const log = logger.child("agents:news-intelligence:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You are the News Intelligence layer of a stock research application, built for people who know very little about investing.

You will receive a JSON array of REAL news articles that were actually retrieved from a news provider (each with a headline, url, source, publishedAt date). This is the complete, real set of articles available -- do not assume any other articles exist.

CRITICAL RULES:
1. NEVER invent an article, headline, source, date, or URL. Every "primaryArticleUrl" and every URL in "relatedArticleUrls" you return MUST be copied EXACTLY (character for character) from the "url" field of one of the articles you were given. Any event whose primaryArticleUrl doesn't exactly match a given article will be discarded entirely, so get this right.
2. Group articles that cover the same underlying event together -- if several articles report the same story, create ONE event (choose the most authoritative source as primaryArticleUrl, list the rest in relatedArticleUrls) rather than treating each as separate. Do not let an event seem more important just because many outlets covered it.
3. Select only the 3-7 MOST IMPORTANT events -- judged by likely impact on the company's business or stock, not by how many articles covered it or how recent it is.
4. Classify recencyType: "recent_event" for something that just happened, "ongoing_issue" for a continuing situation, "historical_background" for older context still relevant today.
5. Write every explanation in plain, everyday language. Whenever you would use a financial or business term (e.g. "guidance", "dilutive offering", "regulatory headwinds"), explain what it means in the same or next sentence. Never leave jargon unexplained.
6. classification (bullish/bearish/neutral) and possibleStockImpact are your interpretation, not fact -- phrase possibleStockImpact as a possibility ("could...", "this may...", "this suggests..."), never as a certainty.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "whatsHappening": {
    "positive": array of 0-4 short plain-language strings (things going well),
    "negative": array of 0-4 short plain-language strings (things going poorly),
    "neutral": array of 0-3 short plain-language strings (notable but not clearly good or bad)
  },
  "importantEvents": [
    {
      "primaryArticleUrl": "must exactly match a url from the input articles",
      "relatedArticleUrls": ["urls of other articles covering the same event, or empty array"],
      "whatHappened": "plain-language explanation of the event",
      "whyItMatters": "plain-language explanation of why this could matter to the company",
      "possibleStockImpact": "plain-language, framed as a possibility, not a certainty",
      "timeHorizon": one of "short_term" | "medium_term" | "long_term",
      "timeHorizonExplanation": "plain language, e.g. 'this effect would likely show up within days to weeks' vs 'months' vs 'years'",
      "importance": one of "low" | "medium" | "high" | "very_high",
      "classification": one of "bullish" | "bearish" | "neutral",
      "recencyType": one of "recent_event" | "ongoing_issue" | "historical_background"
    }
  ]
}

If the input array is empty or contains nothing meaningfully important, return an importantEvents array that is empty and whatsHappening sections that are empty arrays -- do not invent events to fill space.`;

const NewsEventSchema = z.object({
  primaryArticleUrl: z.string().min(1),
  relatedArticleUrls: z.array(z.string()),
  whatHappened: z.string().min(1),
  whyItMatters: z.string().min(1),
  possibleStockImpact: z.string().min(1),
  timeHorizon: z.enum(["short_term", "medium_term", "long_term"]),
  timeHorizonExplanation: z.string().min(1),
  importance: z.enum(["low", "medium", "high", "very_high"]),
  classification: z.enum(["bullish", "bearish", "neutral"]),
  recencyType: z.enum(["recent_event", "ongoing_issue", "historical_background"]),
});

const InterpretationSchema = z.object({
  whatsHappening: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
    neutral: z.array(z.string()),
  }),
  importantEvents: z.array(NewsEventSchema),
});

/**
 * Sends the real fetched articles to Claude for grouping/classification
 * only. After schema validation, every returned event is checked against
 * the actual input article URLs -- an event whose primaryArticleUrl (or
 * any relatedArticleUrl) doesn't match a real fetched article is dropped.
 * This is a structural anti-hallucination guardrail, not just a prompt
 * instruction: the AI cannot make this app display a URL it didn't
 * actually retrieve.
 */
export async function interpretNews(
  ticker: string,
  articles: NewsArticle[]
): Promise<Result<NewsIntelligenceInterpretation>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message:
          "AI interpretation requires ANTHROPIC_API_KEY to be set. The real fetched articles are still " +
          "available without it -- see the response's `articles` field.",
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
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              articles.map((a) => ({
                headline: a.headline,
                url: a.url,
                source: a.source,
                publishedAt: a.publishedAt,
                summary: a.summary,
              }))
            ),
          },
        ],
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

    // Anti-hallucination guardrail: drop any event referencing a URL that
    // wasn't actually in the fetched articles.
    const knownUrls = new Set(articles.map((a) => a.url));
    const verifiedEvents = validation.data.importantEvents
      .filter((event) => {
        const primaryValid = knownUrls.has(event.primaryArticleUrl);
        if (!primaryValid) {
          log.warn("dropping AI-generated event with an unrecognized primaryArticleUrl", {
            ticker,
            url: event.primaryArticleUrl,
          });
        }
        return primaryValid;
      })
      .map((event) => ({
        ...event,
        relatedArticleUrls: event.relatedArticleUrls.filter((u) => knownUrls.has(u)),
      }));

    const interpretation: NewsIntelligenceInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      whatsHappening: validation.data.whatsHappening,
      importantEvents: verifiedEvents,
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
