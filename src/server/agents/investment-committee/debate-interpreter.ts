import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import type {
  DebateExchange,
  Disagreement,
  PersonaEvaluation,
  CommitteeRecommendation,
} from "@/lib/investment-committee-types";

const log = logger.child("agents:investment-committee:debate");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are chairing an investment committee debate for a stock research application, built for people who know very little about investing.

You will receive the SAME real analysis summaries the five analyst personas already used, PLUS those five personas' independent evaluations (already fixed -- treat them as given, do not change what they concluded). Your job is to identify genuine agreements and disagreements between them, construct a few realistic debate exchanges (one persona challenging another, and that persona responding), and produce a final synthesized recommendation.

CRITICAL RULES:
1. finalRecommendation must NOT be a simple majority vote or average of the five personas' recommendations -- the application already counts the votes separately. Your job is a genuine qualitative synthesis: weigh each persona's conviction (confidence), the quality/strength of their reasoning against the real evidence, and how much their specific philosophy actually applies to this specific company and situation. It is fine for your final recommendation to differ from the simple majority if the reasoning genuinely supports that.
2. Do not manufacture disagreement where personas actually agree, and do not paper over real disagreement to make the committee look more unified than it is.
3. debateExchanges should be realistic -- pick 2-4 exchanges where personas would genuinely push back on each other given their stated reasoning, not generic filler.
4. If there is a notable minority view (a persona who disagreed with the majority for a substantive reason), surface it in minorityViewWorthConsidering rather than letting it disappear -- but if there genuinely isn't one, this may be null.
5. NEVER invent financial information beyond what was given to the personas.
6. Write every explanation in plain, everyday language a person with no investing background can understand.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "keyAgreements": [array of short plain-language strings describing what the personas agree on],
  "keyDisagreements": [ { "topic": "short label", "description": "plain-language description of the disagreement", "sidesSummary": "plain language: who leans which way and why" } ],
  "debateExchanges": [ { "personaA": one of the 5 persona keys, "personaB": one of the 5 persona keys, "challenge": "what personaA pushes back on, in plain language", "response": "how personaB responds, in plain language" } ],
  "finalRecommendation": "buy" | "hold" | "sell",
  "finalConfidence": integer 0-100,
  "recommendationRationale": "plain-language explanation of the final recommendation, per rule 1 -- explicitly not a simple vote count",
  "minorityViewWorthConsidering": "plain-language description, or null if there genuinely isn't a notable one",
  "overallConclusion": "2-5 plain-language sentences summarizing the committee's overall view"
}`;

const DisagreementSchema = z.object({
  topic: z.string().min(1),
  description: z.string().min(1),
  sidesSummary: z.string().min(1),
});

const PersonaKeySchema = z.enum([
  "value_investor",
  "growth_investor",
  "momentum_trader",
  "risk_averse_investor",
  "contrarian_investor",
]);

const DebateExchangeSchema = z.object({
  personaA: PersonaKeySchema,
  personaB: PersonaKeySchema,
  challenge: z.string().min(1),
  response: z.string().min(1),
});

const ResponseSchema = z.object({
  keyAgreements: z.array(z.string()),
  keyDisagreements: z.array(DisagreementSchema),
  debateExchanges: z.array(DebateExchangeSchema),
  finalRecommendation: z.enum(["buy", "hold", "sell"]),
  finalConfidence: z.number().min(0).max(100),
  recommendationRationale: z.string().min(1),
  minorityViewWorthConsidering: z.string().nullable(),
  overallConclusion: z.string().min(1),
});

export interface DebateResult {
  keyAgreements: string[];
  keyDisagreements: Disagreement[];
  debateExchanges: DebateExchange[];
  finalRecommendation: CommitteeRecommendation;
  finalConfidence: number;
  recommendationRationale: string;
  minorityViewWorthConsidering: string | null;
  overallConclusion: string;
}

export interface DebateInterpreterInput extends AnalysisSummaries {
  ticker: string;
  companyName: string | null;
  personaEvaluations: PersonaEvaluation[];
}

/**
 * Phase 2 of the committee: given Phase 1's five FIXED independent
 * evaluations plus the same real evidence, produces debate exchanges,
 * agreement/disagreement analysis, and a final synthesized
 * recommendation. Deliberately a separate AI call from Phase 1 so the
 * debate genuinely engages with already-formed positions rather than
 * blending everything into one unstructured pass.
 */
export async function interpretDebate(input: DebateInterpreterInput): Promise<Result<DebateResult>> {
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
        max_tokens: 4096,
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

    return { ok: true, data: validation.data };
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
