import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { CompanyMetricSet, CompetitorAnalysisInterpretation } from "@/lib/competitor-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";
import { callAnthropicForText } from "@/server/agents/shared/call-anthropic";

const log = logger.child("agents:competitor-analysis:interpreter");

const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Competitive Intelligence Agent inside a stock research application, built for people who know very little about business or investing.

You will receive a JSON object with the primary company's ticker/name and a list of candidate competitor tickers/names, each with a REAL, deterministically-calculated set of financial metrics (revenue, revenue growth, earnings growth, net margin, free cash flow, free cash flow growth, debt, cash, ROE, a simple P/E ratio, market cap). A null value means that specific figure wasn't available -- never guess a replacement number for it.

CRITICAL RULES:
1. This app has NO real market-share data. Never state a specific market-share percentage or claim to know exact market share for any company. You may say a company "appears to be gaining/losing ground" based on the relative revenue/earnings growth rates you were given, but frame this explicitly as an inference from growth trends, not a market-share statistic.
2. You may use your general knowledge of what these companies do (their products, customers, business model) to judge why a candidate is a genuinely relevant competitor and to discuss qualitative competitive factors (brand strength, pricing power, technology, barriers to entry, distribution) -- that is normal business analysis, not fabrication. But NEVER invent a specific financial number, date, or statistic beyond what you were given.
3. If a candidate ticker is not actually a meaningful competitor (e.g. wrong business, wrong customers, wrong market), you may exclude it from your competitorSelections and comparisonTable rather than force a weak comparison.
4. Do NOT simply average the metrics into the competitive score. Weight what matters most for this specific company's industry (e.g. growth and cash generation matter more for a fast-growing tech company; balance-sheet strength and margins may matter more for a mature industrial company).
5. For any metric that is null for a company, say "Data unavailable" for that specific comparison rather than guessing or silently omitting the gap.
6. Write every explanation in plain, everyday language a person with no business background can understand. Whenever you'd use a term like "moat", "pricing power", or "operating leverage", explain what it means in the same or next sentence, in the plain style already used elsewhere in this app.

CRITICAL JSON FORMATTING RULE: never place a double-quote character (") inside any string value, including to quote a term or phrase for emphasis (e.g. do NOT write "the \"base case\" scenario" -- write "the base case scenario" instead, with no quotation marks around it at all). A single unescaped internal quote breaks the entire response. If you want to emphasize or name a specific term, write it plainly without surrounding punctuation marks that could be mistaken for a string delimiter.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "competitiveScore": integer from -100 (significant competitive disadvantage) to 100 (exceptionally strong position),
  "confidenceScore": number from 0 to 1,
  "competitorSelections": [ up to 5 items: { "ticker": string, "companyName": string or null, "whyRelevant": "plain-language reason this is a genuine competitor" } ],
  "comparisonTable": [
    {
      "ticker": string,
      "companyName": string or null,
      "growth": one of "leading" | "average" | "lagging" | "unavailable",
      "profitability": one of "leading" | "average" | "lagging" | "unavailable",
      "financialStrength": one of "leading" | "average" | "lagging" | "unavailable",
      "valuation": one of "leading" | "average" | "lagging" | "unavailable",
      "competitivePosition": one of "leading" | "average" | "lagging" | "unavailable"
    }
  ],
  "whoIsWinning": "2-4 plain-language sentences directly answering who is winning and why",
  "companyStrengths": [ up to 5 items: { "factor": "short label", "explanation": "plain-language explanation" } ],
  "companyWeaknesses": [ up to 5 items: { "factor": "short label", "explanation": "plain-language explanation" } ],
  "biggestCompetitiveThreat": "plain-language description of the single biggest competitive threat",
  "overallConclusion": "2-5 plain-language sentences summarizing the competitive picture"
}

Include one comparisonTable row for the primary company and one for each competitor you kept in competitorSelections -- "leading" means better than the peer group on that dimension, "lagging" means worse, "average" means roughly in line, "unavailable" means there wasn't enough real data to judge that dimension for that company. "Valuation" leading means the stock looks relatively cheap compared to peers, not that the business itself is "winning" -- keep these conceptually separate in your explanations.`;

const ComparisonLevelSchema = z.enum(["leading", "average", "lagging", "unavailable"]);

const CompetitorSelectionSchema = z.object({
  ticker: z.string().min(1),
  companyName: z.string().nullable(),
  whyRelevant: z.string().min(1),
});

const ComparisonRowSchema = z.object({
  ticker: z.string().min(1),
  companyName: z.string().nullable(),
  growth: ComparisonLevelSchema,
  profitability: ComparisonLevelSchema,
  financialStrength: ComparisonLevelSchema,
  valuation: ComparisonLevelSchema,
  competitivePosition: ComparisonLevelSchema,
});

const FactorSchema = z.object({ factor: z.string().min(1), explanation: z.string().min(1) });

const InterpretationSchema = z.object({
  competitiveScore: z.number().min(-100).max(100),
  confidenceScore: z.number().min(0).max(1),
  competitorSelections: z.array(CompetitorSelectionSchema),
  comparisonTable: z.array(ComparisonRowSchema),
  whoIsWinning: z.string().min(1),
  companyStrengths: z.array(FactorSchema),
  companyWeaknesses: z.array(FactorSchema),
  biggestCompetitiveThreat: z.string().min(1),
  overallConclusion: z.string().min(1),
});

export interface CompetitorInterpreterInput {
  primaryCompany: CompanyMetricSet;
  candidates: CompanyMetricSet[];
}

/**
 * Sends the primary company's and each candidate competitor's real,
 * deterministically-calculated metrics to Claude for relevance judgment
 * and comparison. Never throws; returns a typed error rather than a
 * fabricated fallback if the key is missing, the request fails, or the
 * response doesn't match the required schema.
 */
export async function interpretCompetitors(
  input: CompetitorInterpreterInput
): Promise<Result<CompetitorAnalysisInterpretation>> {
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

    const interpretation: CompetitorAnalysisInterpretation = {
      source: "ai",
      model: MODEL,
      generatedAt: new Date().toISOString(),
      ...validation.data,
    };

    return { ok: true, data: interpretation };
}
