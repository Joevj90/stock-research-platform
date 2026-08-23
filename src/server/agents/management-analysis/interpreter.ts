import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type {
  CapitalAllocationSignal,
  InsiderActivitySummary,
  ManagementInterpretation,
} from "@/lib/management-types";
import type { InsiderTransaction } from "@/lib/insider-trading-types";
import { parseAiJsonResponse, AiJsonParseError } from "@/server/agents/shared/parse-ai-json";

const log = logger.child("agents:management-analysis:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Management Analysis Agent inside a stock research application, built for people who know very little about investing.

You will receive a JSON object with a ticker, a company name (if known), REAL deterministically-calculated capital-allocation trends (dividends paid, debt, cash, free cash flow, and an implied-share-count trend that suggests buyback activity -- all computed from the company's actual reported financial statements), and a set of REAL individual insider transactions (SEC Form 4 filings) with an aggregated summary.

CRITICAL RULES -- these are more important in this step than almost any other:
1. This app has NO source of historical management guidance statements (e.g. "we expect revenue to grow 20%") and NO source of their actual outcomes, and NO source of earnings-call transcripts. You MUST set "trackRecordVsGuidance" to state plainly that this specific comparison is not available in this analysis due to lack of verified data -- do NOT attempt to recall, estimate, or paraphrase any specific guidance figure, quote, or promise from general knowledge, even if you believe you remember one, because it cannot be sourced or dated reliably for this app. This is a hard rule with no exceptions.
2. You may use general public knowledge of who the company's CEO/CFO are and well-known, broadly-reported facts about their tenure (e.g. "has led the company since X") ONLY if you are genuinely confident and the fact is common public knowledge -- if you are not confident, say management identity/tenure information is limited rather than guessing.
3. NEVER fabricate a specific financial number, transaction, or date. Use only the real capital-allocation trends and insider transactions given to you.
4. Insider SELLING is NOT automatically bearish -- executives sell shares for many reasons (taxes, diversification, planned 10b5-1 sales, personal expenses) unrelated to their view of the company. Never frame a sale as automatically negative; discuss it neutrally unless the pattern (e.g. sustained, large, unplanned-looking selling by multiple executives) is genuinely unusual.
5. Do NOT simply average the individual signals into the management score -- weigh what actually matters (e.g. a company with strong capital allocation and no concerning insider activity should score well even if data is sparse on other fronts; a company with real evidence of poor capital discipline should score lower).
6. Write every explanation in plain, everyday language a person with no investing background can understand. Whenever you'd use a term like "capital allocation discipline" or "credibility", explain what it means in the same or next sentence, in the plain style already used elsewhere in this app (e.g. "Management has generally used the company's money carefully").

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "managementScore": integer from -100 (significant management concerns) to 100 (exceptionally strong execution),
  "overallAssessment": one of "strong" | "good" | "neutral" | "concerning" | "very_concerning",
  "confidenceScore": number from 0 to 1 (low data availability should lower this),
  "whatManagementIsDoingWell": [ up to 5 items: { "factor": "short label", "explanation": "plain-language explanation grounded in the real data given" } ],
  "managementConcerns": [ up to 5 items: { "factor": "short label", "explanation": "plain-language explanation grounded in the real data given" } ],
  "trackRecordVsGuidance": "a plain-language statement that this comparison is not available in this analysis, per rule 1 above -- do not include any specific guidance figure",
  "capitalAllocationAssessment": "2-4 plain-language sentences about how management is using the company's money, grounded in the real trends given",
  "insiderActivityAssessment": "2-4 plain-language sentences about insider buying/selling, explicitly avoiding treating selling as automatically bearish",
  "managementCredibility": one of "high" | "medium" | "low" | "insufficient_data",
  "managementCredibilityExplanation": "plain-language explanation for the credibility rating -- since guidance-tracking data is unavailable, this should mostly reflect data availability and capital-allocation evidence, explicitly noting the guidance-tracking limitation",
  "overallConclusion": "2-5 plain-language sentences summarizing the overall picture"
}

whatManagementIsDoingWell and managementConcerns may each be empty arrays if there isn't genuine evidence either way -- do not force items in to fill space.`;

const FactorSchema = z.object({ factor: z.string().min(1), explanation: z.string().min(1) });

const InterpretationSchema = z.object({
  managementScore: z.number().min(-100).max(100),
  overallAssessment: z.enum(["strong", "good", "neutral", "concerning", "very_concerning"]),
  confidenceScore: z.number().min(0).max(1),
  whatManagementIsDoingWell: z.array(FactorSchema),
  managementConcerns: z.array(FactorSchema),
  trackRecordVsGuidance: z.string().min(1),
  capitalAllocationAssessment: z.string().min(1),
  insiderActivityAssessment: z.string().min(1),
  managementCredibility: z.enum(["high", "medium", "low", "insufficient_data"]),
  managementCredibilityExplanation: z.string().min(1),
  overallConclusion: z.string().min(1),
});

export interface ManagementInterpreterInput {
  ticker: string;
  companyName: string | null;
  capitalAllocation: CapitalAllocationSignal;
  insiderActivitySummary: InsiderActivitySummary;
  recentInsiderTransactions: InsiderTransaction[];
}

/**
 * Sends real capital-allocation trends and real insider transactions to
 * Claude for interpretation only. Never throws; returns a typed error
 * rather than a fabricated fallback if the key is missing, the request
 * fails, or the response doesn't match the required schema.
 */
export async function interpretManagement(
  input: ManagementInterpreterInput
): Promise<Result<ManagementInterpretation>> {
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

    const interpretation: ManagementInterpretation = {
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
