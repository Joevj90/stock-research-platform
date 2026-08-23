import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { AnalysisSummaries } from "@/server/agents/shared/analysis-summaries";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:forecasting:interpreter");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 90_000; // raised now that Vercel Pro allows much longer function execution

const SYSTEM_PROMPT = `You are the Forecasting Agent inside a stock research application, built for people who know very little about investing. Your job is to combine evidence from multiple existing analyses into a forward-looking forecast -- you must NOT blindly trust any single analyst's conclusion.

You will receive a JSON object with the current price, real deterministic DCF fair-value estimates (bear/base/bull) from the app's own Valuation Engine, and compact summaries of whatever other analyses were successfully run for this company (technical, fundamental, sentiment, macro, competitor, management, risk -- each may be missing if that analysis wasn't available, in which case treat it as unavailable rather than guessing what it would have said).

CRITICAL RULES:
1. NEVER invent financial information. Every scenario narrative must be grounded in the real summaries and DCF estimates you were given. If you don't have enough input for a specific horizon (3/6/12 month) to produce a credible forecast, set dataSupportsThisHorizon to false and explain why in limitationNote -- do not force a confident-sounding forecast the evidence doesn't support.
2. For EACH horizon, provide a priceTarget and probabilityPct for bear, base, and bull. You do NOT need to make bear+base+bull probabilities sum to exactly 100 -- the application will normalize them deterministically. Just give your best relative judgment (e.g. base case is much more likely than bear/bull).
3. Do NOT perform the expected-price or expected-return math yourself -- the application calculates those deterministically from your price targets and probabilities. Just provide the scenario prices and probabilities.
4. Use the real DCF bear/base/bull fair values given to you as a strong anchor for your price targets, adjusted by the other real evidence (technical trend, sentiment, macro conditions, competitive position, management execution, and risk level) you were given.
5. confidenceScore (0-100) does NOT mean "how sure are we of the exact price" -- it reflects how RELIABLE the overall forecast is, based on: how much real data was available, how much the different analyses agree with each other, business stability, and valuation/macro/company-specific uncertainty. Disagreement between analyses or missing data should lower this score.
6. Write every explanation in plain, everyday language a person with no investing background can understand. Whenever you'd use a term like "multiple expansion" or "revenue deceleration", explain what it means in the same or next sentence, in the plain style already used elsewhere in this app.
7. keyRisksSummary must be a SHORT summary of what matters most for this forecast, not a duplicate of a full risk analysis.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "horizons": [
    {
      "horizon": "3_month",
      "dataSupportsThisHorizon": boolean,
      "limitationNote": string or null (required, non-null, if dataSupportsThisHorizon is false),
      "bear": { "explanation": string, "estimatedFinancialOutcome": string, "priceTarget": number, "probabilityPct": number, "mainReasons": [up to 3 short strings], "keyRisks": [up to 3 short strings] },
      "base": { same shape as bear },
      "bull": { same shape as bear },
      "mostLikelyScenario": "bear" | "base" | "bull"
    },
    { "horizon": "6_month", ... same shape ... },
    { "horizon": "12_month", ... same shape ... }
  ],
  "keyCatalysts": [ up to 4 items: { "whatCouldHappen": string, "whyItWouldHelp": string, "importance": "low"|"medium"|"high" } ],
  "keyRisksSummary": [ up to 4 short plain-language strings ],
  "confidenceScore": integer 0-100,
  "confidenceExplanation": "plain-language explanation of the confidence score, per rule 5",
  "biggestOptimismReason": "plain-language, the single biggest reason for optimism",
  "biggestRiskReason": "plain-language, the single biggest risk",
  "assumptions": [ up to 5 items: { "assumption": "short label", "explanation": "plain-language explanation of what this assumption means" } ],
  "overallConclusion": "3-5 plain-language sentences, following the pattern: our most likely outcome is the Base Case, the biggest reason for optimism is X, the biggest risk is Y"
}

Provide exactly 3 horizon entries (3_month, 6_month, 12_month), in that order.`;

const ScenarioSchema = z.object({
  explanation: z.string().min(1),
  estimatedFinancialOutcome: z.string().min(1),
  priceTarget: z.number().positive(),
  probabilityPct: z.number().min(0).max(100),
  mainReasons: z.array(z.string()),
  keyRisks: z.array(z.string()),
});

const HorizonSchema = z.object({
  horizon: z.enum(["3_month", "6_month", "12_month"]),
  dataSupportsThisHorizon: z.boolean(),
  limitationNote: z.string().nullable(),
  bear: ScenarioSchema,
  base: ScenarioSchema,
  bull: ScenarioSchema,
  mostLikelyScenario: z.enum(["bear", "base", "bull"]),
});

const CatalystSchema = z.object({
  whatCouldHappen: z.string().min(1),
  whyItWouldHelp: z.string().min(1),
  importance: z.enum(["low", "medium", "high"]),
});

const AssumptionSchema = z.object({ assumption: z.string().min(1), explanation: z.string().min(1) });

const InterpretationSchema = z.object({
  horizons: z.array(HorizonSchema).length(3),
  keyCatalysts: z.array(CatalystSchema),
  keyRisksSummary: z.array(z.string()),
  confidenceScore: z.number().min(0).max(100),
  confidenceExplanation: z.string().min(1),
  biggestOptimismReason: z.string().min(1),
  biggestRiskReason: z.string().min(1),
  assumptions: z.array(AssumptionSchema),
  overallConclusion: z.string().min(1),
});

/** The AI's raw output shape -- note this deliberately does NOT include
 * `expectedPrice`/`expectedReturnPct` (per horizon) or `expectedReturnPct`
 * (per scenario), since those are never asked of the LLM. `service.ts`
 * fills them in via `calculations.ts` to produce the final
 * `ForecastInterpretation` shape. */
export type RawForecastInterpretation = z.infer<typeof InterpretationSchema> & {
  source: "ai";
  model: string;
  generatedAt: string;
};

export interface ForecastInterpreterInput extends AnalysisSummaries {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
}

/**
 * Sends compact real summaries from up to 8 other analysis modules
 * (technical, fundamental, valuation's DCF, sentiment, macro, competitor,
 * management, risk) to Claude for scenario synthesis only. Never throws;
 * returns a typed error rather than a fabricated fallback if the key is
 * missing, the request fails, or the response doesn't match the required
 * schema. Never asked to compute expected price/return -- that's always
 * done deterministically afterward (see calculations.ts).
 */
export async function interpretForecast(
  input: ForecastInterpreterInput
): Promise<Result<RawForecastInterpretation>> {
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
    maxTokens: 8192,
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
      log.error("AI response failed schema validation", { issues: validation.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    // Note: this is the RAW AI shape -- it does not yet include the
    // deterministically-computed expectedPrice/expectedReturnPct fields.
    // service.ts runs this through calculations.ts to produce the final
    // ForecastInterpretation before returning a ForecastResult.
    const interpretation: RawForecastInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...validation.data,
    };

    return { ok: true, data: interpretation };
}
