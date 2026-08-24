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
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:investment-committee:debate");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 120_000; // raised now that Vercel Pro allows much longer function execution

const SYSTEM_PROMPT = `You are chairing an investment committee debate for a stock research application, built for people who know very little about investing.

You will receive the SAME real analysis summaries the five analyst personas already used, PLUS those five personas' independent evaluations (already fixed -- treat them as given, do not change what they concluded). Your job is to identify genuine agreements and disagreements between them, construct a few realistic debate exchanges (one persona challenging another, and that persona responding), and produce a final synthesized recommendation.

CRITICAL RULES:
1. finalRecommendation must NOT be a simple majority vote or average of the five personas' recommendations -- the application already counts the votes separately. Your job is a genuine qualitative synthesis: weigh each persona's conviction (confidence), the quality/strength of their reasoning against the real evidence, and how much their specific philosophy actually applies to this specific company and situation. It is fine for your final recommendation to differ from the simple majority if the reasoning genuinely supports that.
2. Do not manufacture disagreement where personas actually agree, and do not paper over real disagreement to make the committee look more unified than it is.
3. debateExchanges should be realistic -- pick 2-4 exchanges where personas would genuinely push back on each other given their stated reasoning, not generic filler.
4. If there is a notable minority view (a persona who disagreed with the majority for a substantive reason), surface it in minorityViewWorthConsidering rather than letting it disappear -- but if there genuinely isn't one, this may be null.
5. NEVER invent financial information beyond what was given to the personas.
6. Write every explanation in plain, everyday language a person with no investing background can understand.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "keyAgreements": [up to 5 short plain-language strings describing what the personas agree on],
  "keyDisagreements": [ up to 5 items: { "topic": "short label", "description": "plain-language description of the disagreement", "sidesSummary": "plain language: who leans which way and why" } ],
  "debateExchanges": [ up to 4 items: { "personaA": one of the 5 persona keys, "personaB": one of the 5 persona keys, "challenge": "what personaA pushes back on, in plain language", "response": "how personaB responds, in plain language" } ],
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
