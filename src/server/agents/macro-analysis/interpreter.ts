import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { MacroIndicator, MacroInterpretation } from "@/lib/macro-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:macro-analysis:interpreter");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Macro Economics Agent inside a stock research application, built for people who know very little about economics.

You will receive a JSON object with a ticker, a company name (if known), and a list of REAL economic indicators (each with its real value, unit, source, and date -- e.g. GDP growth, inflation/CPI, unemployment rate, the 10-year Treasury yield). These are the ONLY real data points you have; no commodity prices, dollar index, credit spreads, or housing data were fetched for this analysis.

CRITICAL RULES:
1. Do NOT write a generic economic report. Your entire job is: "which of these economic conditions actually matter for THIS specific company, and are they currently helping or hurting it?" A factor irrelevant to this company's business should not be forced into the analysis.
2. You may use your general knowledge of what industry/business this company is in (e.g. that it is a bank, a retailer, an oil company, a technology company) to judge which macro factors are relevant -- that is normal analytical reasoning, not fabrication. If you are not confident what business the company is in, say so and keep the analysis more general.
3. NEVER fabricate a specific economic statistic, data point, or date. Use only the indicator values given to you. If a factor you'd want data for (e.g. dollar strength, commodity prices, credit conditions, consumer spending) wasn't provided, you may still discuss the general directional concept in plain language, but do not state a specific number for it that wasn't given to you.
4. Do NOT simply average all factors into the score. Weight factors according to how much they actually matter to this specific company's business.
5. Write every explanation in plain, everyday language a person with no economics background can understand. Whenever you'd naturally use an economic term (e.g. "restrictive monetary policy", "risk-off", "currency headwind"), explain what it means in the same or next sentence, in the plain style already used elsewhere in this app (e.g. "High interest rates can make investors less willing to pay very high prices for stocks, which could put pressure on this company's stock price.").

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "macroScore": integer from -100 (extremely unfavorable for this company) to 100 (extremely favorable),
  "overallMacroEnvironment": one of "favorable" | "neutral" | "unfavorable",
  "confidenceScore": number from 0 to 1,
  "positiveFactors": [ up to 4 items: { "factor": string, "whatIsHappening": string, "whyItMattersToCompany": string, "effect": "positive", "significance": "low"|"medium"|"high", "timeHorizon": "short_term"|"medium_term"|"long_term" } ],
  "negativeFactors": [ up to 4 items, same shape as positiveFactors but "effect": "negative" ],
  "mostImportantMacroFactor": "short plain-language name of the single most important factor for this company right now",
  "biggestMacroRisk": { "whatCouldHappen": string, "whyItWouldMatter": string, "effect": "positive"|"neutral"|"negative", "significance": "low"|"medium"|"high" },
  "importantMacroRisks": [ 2 to 5 items in the same shape as biggestMacroRisk ],
  "timeHorizon": one of "short_term" | "medium_term" | "long_term",
  "overallConclusion": "2-5 plain-language sentences explaining the overall macro picture for this specific company"
}

Only include factors in positiveFactors/negativeFactors that are genuinely relevant to this company -- it is fine to have very few of either if few of the given indicators actually matter to this business.`;

const FactorSchema = z.object({
  factor: z.string().min(1),
  whatIsHappening: z.string().min(1),
  whyItMattersToCompany: z.string().min(1),
  effect: z.enum(["positive", "neutral", "negative"]),
  significance: z.enum(["low", "medium", "high"]),
  timeHorizon: z.enum(["short_term", "medium_term", "long_term"]),
});

const RiskSchema = z.object({
  whatCouldHappen: z.string().min(1),
  whyItWouldMatter: z.string().min(1),
  effect: z.enum(["positive", "neutral", "negative"]),
  significance: z.enum(["low", "medium", "high"]),
});

const InterpretationSchema = z.object({
  macroScore: z.number().min(-100).max(100),
  overallMacroEnvironment: z.enum(["favorable", "neutral", "unfavorable"]),
  confidenceScore: z.number().min(0).max(1),
  positiveFactors: z.array(FactorSchema),
  negativeFactors: z.array(FactorSchema),
  mostImportantMacroFactor: z.string().min(1),
  biggestMacroRisk: RiskSchema,
  importantMacroRisks: z.array(RiskSchema).min(2).max(5),
  timeHorizon: z.enum(["short_term", "medium_term", "long_term"]),
  overallConclusion: z.string().min(1),
});

export interface MacroInterpreterInput {
  ticker: string;
  companyName: string | null;
  indicators: MacroIndicator[];
}

/**
 * Sends real economic indicators (and the ticker/company name, so the
 * model can apply company-specific relevance) to Claude for
 * interpretation only. Never throws; returns a typed error rather than a
 * fabricated fallback if the key is missing, the request fails, or the
 * response doesn't match the required schema.
 */
export async function interpretMacroEnvironment(
  input: MacroInterpreterInput
): Promise<Result<MacroInterpretation>> {
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

    const interpretation: MacroInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...validation.data,
    };

    return { ok: true, data: interpretation };
}
