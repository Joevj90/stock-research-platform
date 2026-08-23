import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import type { PersonaEvaluation } from "@/lib/investment-committee-types";
import { parseAiJsonResponse } from "@/server/agents/shared/parse-ai-json";

const log = logger.child("agents:investment-committee:personas");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
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

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "personaEvaluations": [
    {
      "persona": "value_investor",
      "recommendation": "buy" | "hold" | "sell",
      "confidence": integer 0-100,
      "keyReasons": [array of short plain-language strings, grounded in the given data],
      "concernsOrCaveats": [array of short plain-language strings],
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
      parsedJson = parseAiJsonResponse(rawText);
    } catch {
      log.error("Failed to parse AI response as JSON", { rawText: rawText.slice(0, 500) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response was not valid JSON." } };
    }

    const validation = ResponseSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", { issues: validation.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    return { ok: true, data: validation.data.personaEvaluations };
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
