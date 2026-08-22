import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import type { CommitteeInterpretation } from "@/lib/investment-committee-types";
import type { ForecastInterpretation, ForecastHorizonKey } from "@/lib/forecast-types";
import type { CommitteeReview, DevilsAdvocateInterpretation } from "@/lib/devils-advocate-types";

const log = logger.child("agents:devils-advocate:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 120_000; // large, detailed response -- more headroom than the app's other single-call agents

const SYSTEM_PROMPT = `You are the Devil's Advocate inside a stock research application, built for people who know very little about investing. Your job is to challenge the Investment Committee's conclusion -- NOT to be automatically bearish. Your real question is: "why might our current conclusion be wrong?"

You will receive: the same real compact summaries of 8 analyses (technical, fundamental, valuation, sentiment, macro, competitor, management, risk) the Committee used, the Committee's actual rating/confidence/vote tally/agreements/disagreements, and the Forecasting Agent's actual 12-month bear/base/bull scenario data (prices, probabilities, expected price, expected return, confidence).

CRITICAL RULES:
1. Actively search for weaknesses -- overlooked evidence, questionable assumptions, overconfidence, contradictions between the analyses, and whether good news might already be priced into the stock. If the case for the current conclusion is genuinely strong, say so honestly (a low challenge score is a legitimate, correct output) -- but don't default to a lukewarm, generic critique either.
2. You do NOT have detailed period-by-period historical data in this analysis -- only the summarized conclusions given to you. If you want to make a historical comparison (e.g. "this looks like a previous period of..."), you may ONLY reference what's explicit in the given summaries and must say historical comparison is limited given the available data rather than inventing a specific past event, date, or figure you don't actually have.
3. NEVER invent evidence, statistics, or events. Every weakness and alternative interpretation must be grounded in the real summaries and real Committee/Forecast data given to you.
4. overallChallengeScore (0-100) measures how strongly the CURRENT THESIS should be challenged -- it is NOT a bearish score. A stock with a well-supported bullish thesis and a stock with a well-supported bearish thesis can both score low here if the evidence genuinely supports the conclusion; a thesis (bullish OR bearish) built on weak or contradictory evidence should score high.
5. Reduce your stated confidence concerns when: data is incomplete (note which analyses were unavailable), analysts genuinely disagreed, the valuation depends on aggressive assumptions, or the situation is inherently hard to forecast. Do not let the output sound more certain than the evidence supports.
6. couldThisChangeTheRating and the committeeReview fields: only propose a revision to the rating/confidence when your critique genuinely justifies it -- do NOT automatically soften or change the conclusion. If your critique is real but not strong enough to flip the rating, say so (wasThesisRevised: false) and explain why the original conclusion still stands despite the weaknesses you found.
7. Write every explanation in plain, everyday language a person with no investing background can understand. Whenever you'd use a term like "terminal growth assumption" or "priced in", explain what it means in the same or next sentence, in the plain style already used elsewhere in this app.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "overallChallengeScore": integer 0-100,
  "challengeLevel": one of "low" | "moderate" | "high" | "very_high",
  "majorWeaknesses": [ { "problem": string, "evidence": string, "whyItMatters": string, "severity": "low"|"medium"|"high"|"critical", "couldChangeConclusion": boolean, "recommendedAdjustment": string or null } ],
  "overlookedRisks": [array of short plain-language strings],
  "questionableAssumptions": [array of short plain-language strings],
  "contradictoryEvidence": [array of short plain-language strings describing tensions between the given analyses],
  "alternativeInterpretations": [ { "fact": "the real evidence", "commonInterpretation": "the obvious reading", "alternativeInterpretation": "a reasonable different reading" } ],
  "confidenceConcerns": [ { "concern": string, "explanation": string } ],
  "whatAssumptionWorriesMost": "plain language, the single assumption most likely to be wrong",
  "couldThisChangeTheRating": "yes" | "no" | "possibly",
  "whyChangeOrNot": "plain-language explanation",
  "recommendedChanges": [array of short plain-language strings],
  "finalConclusion": "2-5 plain-language sentences",
  "committeeReview": {
    "wasThesisRevised": boolean,
    "revisedRating": "buy" | "hold" | "sell" or null (null if wasThesisRevised is false),
    "revisedConfidence": integer 0-100 or null (null if wasThesisRevised is false),
    "whatChangedAndWhy": "plain-language explanation, or null if wasThesisRevised is false"
  }
}`;

const WeaknessSchema = z.object({
  problem: z.string().min(1),
  evidence: z.string().min(1),
  whyItMatters: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  couldChangeConclusion: z.boolean(),
  recommendedAdjustment: z.string().nullable(),
});

const AlternativeInterpretationSchema = z.object({
  fact: z.string().min(1),
  commonInterpretation: z.string().min(1),
  alternativeInterpretation: z.string().min(1),
});

const ConfidenceConcernSchema = z.object({ concern: z.string().min(1), explanation: z.string().min(1) });

const CommitteeReviewSchema = z
  .object({
    wasThesisRevised: z.boolean(),
    revisedRating: z.enum(["buy", "hold", "sell"]).nullable(),
    revisedConfidence: z.number().min(0).max(100).nullable(),
    whatChangedAndWhy: z.string().nullable(),
  })
  .refine(
    (v) =>
      v.wasThesisRevised
        ? v.revisedRating !== null && v.revisedConfidence !== null && v.whatChangedAndWhy !== null
        : v.revisedRating === null && v.revisedConfidence === null,
    {
      message:
        "revisedRating/revisedConfidence/whatChangedAndWhy must be non-null when wasThesisRevised is true, and revisedRating/revisedConfidence must be null when wasThesisRevised is false",
    }
  );

const ResponseSchema = z.object({
  overallChallengeScore: z.number().min(0).max(100),
  challengeLevel: z.enum(["low", "moderate", "high", "very_high"]),
  majorWeaknesses: z.array(WeaknessSchema),
  overlookedRisks: z.array(z.string()),
  questionableAssumptions: z.array(z.string()),
  contradictoryEvidence: z.array(z.string()),
  alternativeInterpretations: z.array(AlternativeInterpretationSchema),
  confidenceConcerns: z.array(ConfidenceConcernSchema),
  whatAssumptionWorriesMost: z.string().min(1),
  couldThisChangeTheRating: z.enum(["yes", "no", "possibly"]),
  whyChangeOrNot: z.string().min(1),
  recommendedChanges: z.array(z.string()),
  finalConclusion: z.string().min(1),
  committeeReview: CommitteeReviewSchema,
});

export interface DevilsAdvocateInterpreterInput extends AnalysisSummaries {
  ticker: string;
  companyName: string | null;
  committee: {
    finalRecommendation: CommitteeInterpretation["finalRecommendation"];
    finalConfidence: number;
    voteTally: CommitteeInterpretation["voteTally"];
    keyAgreements: string[];
    keyDisagreements: CommitteeInterpretation["keyDisagreements"];
    recommendationRationale: string;
  };
  forecastTwelveMonth: {
    horizon: ForecastHorizonKey;
    bear: ForecastInterpretation["horizons"][number]["bear"];
    base: ForecastInterpretation["horizons"][number]["base"];
    bull: ForecastInterpretation["horizons"][number]["bull"];
    expectedPrice: number;
    expectedReturnPct: number;
    confidenceScore: number;
  } | null;
}

export interface DevilsAdvocateInterpreterOutput {
  interpretation: DevilsAdvocateInterpretation;
  committeeReview: CommitteeReview;
}

/**
 * Sends the real Committee conclusion and real Forecast scenario data
 * (plus the same 8 base summaries) to Claude for critique only. Never
 * throws; returns a typed error rather than a fabricated fallback if the
 * key is missing, the request fails, or the response doesn't match the
 * required schema.
 */
export async function interpretDevilsAdvocate(
  input: DevilsAdvocateInterpreterInput
): Promise<Result<DevilsAdvocateInterpreterOutput>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "AI interpretation requires ANTHROPIC_API_KEY to be set." },
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
        max_tokens: 6144,
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

    const validation = ResponseSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", { issues: validation.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    const { committeeReview, ...rest } = validation.data;

    const interpretation: DevilsAdvocateInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...rest,
    };

    return { ok: true, data: { interpretation, committeeReview } };
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
