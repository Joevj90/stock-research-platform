import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CalculatedFundamentalMetrics, FundamentalAnalystInterpretation } from "@/lib/fundamental-analyst-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";

const log = logger.child("agents:fundamental-analyst:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Fundamental Analyst inside a stock research application, built for people who know very little about investing.

You will receive a JSON object of financial metrics that were already calculated deterministically in code from a company's REAL, actually-reported financial statements (revenue, earnings, margins, growth rates, ROE, ROIC, debt ratios, earnings quality, etc., across multiple fiscal years where available).

CRITICAL RULES -- follow these exactly:
1. NEVER invent, estimate, or guess a financial number. Use ONLY the numbers given to you in the input JSON.
2. If a metric you would want for a given assessment is null in the input, you MUST say "Data unavailable." for that specific point rather than filling in a plausible-sounding number or silently skipping it.
3. Every "whatHappened" statement must be traceable to a specific number in the input. Do not describe a trend that isn't actually present in the numbers you were given.
4. Do not simply average the individual metrics into the overall score -- weigh them by importance and describe your reasoning in overallConclusion.
5. Write every explanation in plain, everyday language a person with no finance background can understand. Whenever you would naturally use a financial term (margin, leverage, ROE, ROIC, free cash flow, earnings quality, asset turnover, etc.), immediately explain what it means in the same sentence or the next one. Never use unexplained jargon.

For EACH of the seven assessments (revenue, earnings, profitability, cashFlow, balanceSheet, growth, financialStrength), provide exactly three short parts:
- whatHappened: what the numbers actually show (cite specific figures/percentages given to you, or say "Data unavailable.")
- whyItMatters: why a normal person should care, in plain language
- isGoodOrBad: a plain-language verdict (e.g. "This is a positive sign." / "This is a warning sign." / "This is mixed / not clearly good or bad.")

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "overallFundamentalScore": integer from -100 (very financially unhealthy) to 100 (very financially healthy),
  "confidenceScore": number from 0 to 1 representing how much real data was available to base this on (fewer periods or more nulls = lower confidence),
  "revenueAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "earningsAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "profitabilityAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "cashFlowAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "balanceSheetAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "growthAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "financialStrengthAssessment": { "whatHappened": string, "whyItMatters": string, "isGoodOrBad": string },
  "positiveFactors": up to 5 short plain-language strings, each citing a specific given number,
  "negativeFactors": up to 5 short plain-language strings, each citing a specific given number,
  "importantTrends": up to 4 short plain-language strings describing multi-period patterns actually present in the data,
  "keyConcerns": up to 4 short plain-language strings -- empty array if there are genuinely none,
  "overallConclusion": a 3-5 sentence plain-language synthesis explaining the overall score, written the way you'd explain it to a friend with no finance background
}`;

const AssessmentSchema = z.object({
  whatHappened: z.string().min(1),
  whyItMatters: z.string().min(1),
  isGoodOrBad: z.string().min(1),
});

const InterpretationSchema = z.object({
  overallFundamentalScore: z.number().min(-100).max(100),
  confidenceScore: z.number().min(0).max(1),
  revenueAssessment: AssessmentSchema,
  earningsAssessment: AssessmentSchema,
  profitabilityAssessment: AssessmentSchema,
  cashFlowAssessment: AssessmentSchema,
  balanceSheetAssessment: AssessmentSchema,
  growthAssessment: AssessmentSchema,
  financialStrengthAssessment: AssessmentSchema,
  positiveFactors: z.array(z.string()),
  negativeFactors: z.array(z.string()),
  importantTrends: z.array(z.string()),
  keyConcerns: z.array(z.string()),
  overallConclusion: z.string().min(1),
});

/**
 * Sends the already-calculated fundamental metrics to Claude for
 * interpretation only -- same contract as the Technical Analysis Agent's
 * interpreter. Never throws; returns a typed error if the key is missing,
 * the request fails, or the response doesn't match the required schema.
 */
export async function interpretFundamentalMetrics(
  metrics: CalculatedFundamentalMetrics
): Promise<Result<FundamentalAnalystInterpretation>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message:
          "AI interpretation requires ANTHROPIC_API_KEY to be set. Calculated metrics are still " +
          "available without it -- see the response's `calculated` field.",
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
        messages: [{ role: "user", content: JSON.stringify(metrics) }],
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

    const interpretation: FundamentalAnalystInterpretation = {
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
