import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";
import type { Result } from "@/lib/types";
import type { ComparisonDeltas, SavedAnalysisRecord } from "@/lib/analysis-history-types";

const log = logger.child("analysis-history:comparison-interpreter");

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6144;
const FETCH_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT = `You are comparing two real, already-completed investment analyses of the same company, produced at two different times. This is a FOCUSED comparison task, not a new analysis -- you are explaining what changed between two real conclusions that already exist, not forming a new opinion from scratch.

You will receive the previous analysis and the current (new) analysis in full -- their ratings, prices, confidence scores, and real conclusions from valuation, sentiment, macro, competitor, management, the Investment Committee, and the Devil's Advocate -- plus deterministic price/confidence/return deltas already calculated between them.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis. A single unescaped internal quote breaks the entire response.

CRITICAL RULES:
1. Do NOT change the rating assessment simply because the stock price changed -- a rating should only be described as justified in changing because the underlying evidence or investment case changed. If the price moved a lot but the real conclusions (valuation, fundamentals, committee reasoning) are largely the same, say so explicitly.
2. You MUST separate what changed because of the STOCK PRICE (the market re-pricing the same expectations) from what changed because of the BUSINESS (the actual company/outlook changing) -- these are different sections in your response. A stock can rise 20% with almost no change in the business outlook if investors are simply paying more for the same expected earnings; make that distinction explicit when it applies.
3. whatChanged must contain between 3 and 7 items -- pick the most important, not everything you can find.
4. thesisChangeLevel is one of exactly 4 levels (no_significant_change / slightly_changed / significantly_changed / completely_changed) -- choose based on whether the REASONING and evidence changed, not just the numbers.
5. NEVER invent a fact, statistic, or conclusion beyond what was given to you in the two analyses.
6. Write every explanation in plain, everyday language a person with no investing background can understand.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "whatChanged": [
    { "whatChanged": "plain-language description of one specific change", "whyItMatters": "plain-language explanation", "direction": "improved" | "weakened" | "no_effect" | "uncertain" }
  ],
  "thesisChangeLevel": "no_significant_change" | "slightly_changed" | "significantly_changed" | "completely_changed",
  "thesisChangeExplanation": "plain-language explanation of the thesis-change level chosen",
  "ratingChangeExplanation": "plain-language explanation of why the rating did or didn't change -- per rule 1, never attribute a change to price movement alone",
  "priceRelatedChanges": [array of short plain-language strings describing what changed specifically because of the stock price re-pricing, not the business itself -- empty array if none apply],
  "businessRelatedChanges": [array of short plain-language strings describing what changed specifically because of the actual business/outlook -- empty array if none apply],
  "whatImproved": [array of short plain-language strings],
  "whatGotWorse": [array of short plain-language strings],
  "whatStayedTheSame": [array of short plain-language strings],
  "whyOpinionChanged": "2-5 plain-language sentences explaining why the overall opinion did or didn't change",
  "finalBottomLine": "1-3 plain-language sentences on whether the stock looks more attractive, less attractive, or roughly the same compared with the previous analysis"
}

whatChanged must contain between 3 and 7 items.`;

const WhatChangedItemSchema = z.object({
  whatChanged: z.string().min(1),
  whyItMatters: z.string().min(1),
  direction: z.enum(["improved", "weakened", "no_effect", "uncertain"]),
});

const ResponseSchema = z.object({
  whatChanged: z.array(WhatChangedItemSchema).min(3).max(7),
  thesisChangeLevel: z.enum(["no_significant_change", "slightly_changed", "significantly_changed", "completely_changed"]),
  thesisChangeExplanation: z.string().min(1),
  ratingChangeExplanation: z.string().min(1),
  priceRelatedChanges: z.array(z.string()),
  businessRelatedChanges: z.array(z.string()),
  whatImproved: z.array(z.string()),
  whatGotWorse: z.array(z.string()),
  whatStayedTheSame: z.array(z.string()),
  whyOpinionChanged: z.string().min(1),
  finalBottomLine: z.string().min(1),
});

export type ComparisonNarrative = z.infer<typeof ResponseSchema>;

export interface ComparisonInterpreterInput {
  ticker: string;
  companyName: string | null;
  previous: SavedAnalysisRecord;
  current: SavedAnalysisRecord;
  deltas: ComparisonDeltas;
}

/**
 * Compares two real, already-completed analyses and explains what
 * changed. Only ever called when the user explicitly clicks "Research
 * Again" -- never on a schedule, never automatically. This is the ONLY
 * new AI call this step introduces; everything else reuses the existing
 * Final Report flow (Steps 1-17) unchanged.
 */
export async function interpretComparison(input: ComparisonInterpreterInput): Promise<Result<ComparisonNarrative>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: { code: "AI_NOT_CONFIGURED", message: "AI interpretation requires ANTHROPIC_API_KEY to be set." },
    };
  }

  const callResult = await callAnthropicForText({
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(input),
    maxTokens: MAX_TOKENS,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!callResult.ok) return callResult;
  const rawText = callResult.data;

  let parsedJson: unknown;
  try {
    parsedJson = parseAiJsonResponse(rawText);
  } catch (err) {
    const diag =
      err instanceof AiJsonParseError
        ? ` [diag: ${err.message}${err.snippetAtFailure ? ` | at failure: ...${err.snippetAtFailure}...` : ` | start: "${err.snippetStart.slice(0, 100)}" end: "${err.snippetEnd.slice(-100)}"`}]`
        : ``;
    log.error("Failed to parse AI response as JSON", {
      rawTextLength: rawText.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: { code: "AI_PARSE_ERROR", message: `AI response was not valid JSON.${diag}` } };
  }

  const validation = ResponseSchema.safeParse(parsedJson);
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

  return { ok: true, data: validation.data };
}
