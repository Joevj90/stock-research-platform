import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { NewsArticle, NewsIntelligenceInterpretation } from "@/lib/news-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:news-intelligence:interpreter");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 90_000; // raised now that Vercel Pro allows much longer function execution -- also used as a dependency by Sentiment, Risk, and Final Report

const SYSTEM_PROMPT = `You are the News Intelligence layer of a stock research application, built for people who know very little about investing.

You will receive a JSON array of REAL news articles that were actually retrieved from a news provider (each with a headline, url, source, publishedAt date). This is the complete, real set of articles available -- do not assume any other articles exist.

CRITICAL RULES:
1. NEVER invent an article, headline, source, date, or URL. Every "primaryArticleUrl" and every URL in "relatedArticleUrls" you return MUST be copied EXACTLY (character for character) from the "url" field of one of the articles you were given. Any event whose primaryArticleUrl doesn't exactly match a given article will be discarded entirely, so get this right.
2. Group articles that cover the same underlying event together -- if several articles report the same story, create ONE event (choose the most authoritative source as primaryArticleUrl, list the rest in relatedArticleUrls) rather than treating each as separate. Do not let an event seem more important just because many outlets covered it.
3. Select only the 3-7 MOST IMPORTANT events -- judged by likely impact on the company's business or stock, not by how many articles covered it or how recent it is.
4. Classify recencyType: "recent_event" for something that just happened, "ongoing_issue" for a continuing situation, "historical_background" for older context still relevant today.
5. Write every explanation in plain, everyday language. Whenever you would use a financial or business term (e.g. "guidance", "dilutive offering", "regulatory headwinds"), explain what it means in the same or next sentence. Never leave jargon unexplained.
6. classification (bullish/bearish/neutral) and possibleStockImpact are your interpretation, not fact -- phrase possibleStockImpact as a possibility ("could...", "this may...", "this suggests..."), never as a certainty.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

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

  const callResult = await callAnthropicForText({
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(
      articles.map((a) => ({
        headline: a.headline,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        summary: a.summary,
      }))
    ),
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
      const issues = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

      log.error("AI response failed schema validation", { issues });

      return {

        ok: false,

        error: {

          code: "AI_PARSE_ERROR",

          message: `AI response did not match the required schema. [diag: ${issues.slice(0, 5).join("; ")}]`,

        },

      };
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
}
