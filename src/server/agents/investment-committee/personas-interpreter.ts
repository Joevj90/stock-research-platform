import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import type { PersonaEvaluation } from "@/lib/investment-committee-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:investment-committee:personas");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 90_000; // raised now that Vercel Pro allows much longer function execution

const SYSTEM_PROMPT = `You are generating five INDEPENDENT investment analyst evaluations for a stock research application, built for people who know very little about investing. You will receive real summaries from technical, fundamental, valuation, sentiment, macro, competitor, management, and risk analyses of one company.

Produce exactly 5 evaluations, one for EACH of these personas, each with a genuinely distinct investment philosophy:
- value_investor: cares most about whether the price is cheap relative to real earnings/assets/cash flow; skeptical of high valuations regardless of growth story; wants a margin of safety.
- growth_investor: cares most about revenue/earnings growth trajectory and future potential; more willing to pay a high price for a business growing quickly; less concerned with current valuation multiples.
- momentum_trader: cares most about the technical trend, price action, and market sentiment; less interested in long-term fundamentals; wants confirmation that the trend is currently favorable.
- risk_averse_investor: cares most about balance sheet strength, downside protection, low volatility, management credibility, and avoiding permanent capital loss; would rather miss an opportunity than take a big risk.
- contrarian_investor: actively looks for where the crowd (sentiment, momentum, consensus valuation) might be wrong; more interested when sentiment is very negative but fundamentals are intact, or skeptical when everyone is overly optimistic.

CRITICAL RULES:
1. These personas MUST genuinely reason independently from the SAME evidence and MAY reach different conclusions. Do NOT simply restate the same recommendation five times with different wording -- if the value investor and the momentum trader would reasonably disagree given this data, let them disagree.
2. NEVER invent financial information beyond what is given to you in the summaries.
3. Each persona's reasoning should be recognizably driven by ITS OWN stated philosophy, not a generic "here are some pros and cons."
4. Write every explanation in plain, everyday language a person with no investing background can understand.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "personaEvaluations": [
    {
      "persona": "value_investor",
      "recommendation": "buy" | "hold" | "sell",
      "confidence": integer 0-100,
      "keyReasons": [up to 4 short plain-language strings, grounded in the given data],
      "concernsOrCaveats": [up to 3 short plain-language strings],
      "whatTheyWeighMost": "1 short plain-language sentence describing this persona's lens on this specific stock"
    },
    { same shape, "persona": "growth_investor" },
    { same shape, "persona": "momentum_trader" },
    { same shape, "persona": "risk_averse_investor" },
    { same shape, "persona": "contrarian_investor" }
  ]
}

Provide exactly 5 entries, one per persona listed above, in that order.`;

const PersonaSchema = z.object({
  persona: z.enum(["value_investor", "growth_investor", "momentum_trader", "risk_averse_investor", "contrarian_investor"]),
  recommendation: z.enum(["buy", "hold", "sell"]),
  confidence: z.number().min(0).max(100),
  keyReasons: z.array(z.string()),
  concernsOrCaveats: z.array(z.string()),
  whatTheyWeighMost: z.string().min(1),
});

const ResponseSchema = z.object({
  personaEvaluations: z.array(PersonaSchema).length(5),
});

export interface PersonasInterpreterInput extends AnalysisSummaries {
  ticker: string;
  companyName: string | null;
}

/**
 * Phase 1 of the committee: five independent persona evaluations from the
 * SAME real evidence, produced by a single AI call (rather than five
 * separate API calls) purely for cost efficiency -- the personas are
 * still structurally required to be distinct via the schema and the
 * system prompt's explicit "do not restate the same recommendation five
 * times" instruction.
 */
export async function interpretPersonas(
  input: PersonasInterpreterInput
): Promise<Result<PersonaEvaluation[]>> {
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

    const validation = ResponseSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", { issues: validation.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    return { ok: true, data: validation.data.personaEvaluations };
}
