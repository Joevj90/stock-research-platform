import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type {
  DcfResult,
  HistoricalComparison,
  PeerComparison,
  ValuationInterpretation,
  ValuationMetrics,
} from "@/lib/valuation-types";
import { parseAiJsonResponse } from "@/server/agents/shared/parse-ai-json";

const log = logger.child("agents:valuation-engine:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 55_000; // raised from 45s -- stays under Vercel's 60s function limit while giving real-data generation more room

const SYSTEM_PROMPT = `You are the Valuation Engine's interpretation layer inside a stock research application, built for people who know very little about investing.

You will receive a JSON object containing: valuation metrics (P/E, PEG, EV/EBITDA, etc.), a comparison against the company's own historical valuation, a comparison against real peer companies, and a DCF (discounted cash flow) analysis with bear/base/bull scenarios, a fair value range, and sensitivity analysis. ALL of these numbers were already calculated deterministically in code from real data -- you are not calculating anything, only interpreting what is given to you.

CRITICAL RULES:
1. NEVER invent, estimate, or recompute a numeric value. Use ONLY the numbers given to you. If a metric's value is null, treat it as unavailable and do not guess a number for it.
2. Your job is to decide an overall valuation rating and explain it in plain, everyday language -- someone with no investing background should understand every sentence you write.
3. Whenever you use a financial term, explain what it means in the same or next sentence. For example, don't just say "P/E is 38x" -- say something like "investors are currently paying about $38 for every $1 of the company's yearly earnings."
4. Always explicitly name the single biggest source of uncertainty in this valuation (e.g. "this depends heavily on whether the company can keep growing at its recent pace").
5. Explain the DCF assumptions given to you in plain language, one explanation per assumption (revenue growth, terminal growth, operating margin, tax rate, capital expenditures, working capital, discount rate, terminal growth rate) -- describe what the number given to you means, not why it was chosen.
6. Never present the DCF's fair value or any assumption as a certain fact -- always frame it as an estimate that depends on the assumptions used.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "rating": one of "cheap" | "reasonably_priced" | "expensive" | "very_expensive",
  "explanation": "2-5 plain-language sentences explaining the rating, citing specific numbers you were given",
  "biggestUncertainty": "1-2 plain-language sentences naming the single biggest source of uncertainty",
  "assumptionExplanations": [
    { "key": "initialRevenueGrowthPct", "label": "Revenue growth", "explanation": "plain language, referencing the actual number given to you" },
    { "key": "terminalRevenueGrowthPct", "label": "Long-term revenue growth", "explanation": "..." },
    { "key": "operatingMarginPct", "label": "Operating margin", "explanation": "..." },
    { "key": "taxRatePct", "label": "Tax rate", "explanation": "..." },
    { "key": "capexAsPctOfRevenue", "label": "Capital expenditures", "explanation": "..." },
    { "key": "workingCapitalChangeAsPctOfRevenue", "label": "Working capital", "explanation": "..." },
    { "key": "discountRatePct", "label": "Discount rate", "explanation": "..." },
    { "key": "terminalGrowthRatePct", "label": "Terminal growth rate", "explanation": "..." }
  ],
  "confidenceScore": number from 0 to 1 representing how much real data was available to base this on (more nulls / fewer peers / fewer historical periods = lower confidence)
}`;

const AssumptionExplanationSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  explanation: z.string().min(1),
});

const InterpretationSchema = z.object({
  rating: z.enum(["cheap", "reasonably_priced", "expensive", "very_expensive"]),
  explanation: z.string().min(1),
  biggestUncertainty: z.string().min(1),
  assumptionExplanations: z.array(AssumptionExplanationSchema),
  confidenceScore: z.number().min(0).max(1),
});

export interface ValuationInterpreterInput {
  metrics: ValuationMetrics;
  historicalComparison: HistoricalComparison;
  peerComparison: PeerComparison;
  dcf: DcfResult;
}

/**
 * Sends the already-calculated valuation data to Claude for
 * interpretation only. Same contract as every other agent's interpreter
 * in this app: never throws, returns a typed error rather than a
 * fabricated fallback if the key is missing, the request fails, or the
 * response doesn't match the required schema.
 */
export async function interpretValuation(
  input: ValuationInterpreterInput
): Promise<Result<ValuationInterpretation>> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message:
          "AI interpretation requires ANTHROPIC_API_KEY to be set. The calculated metrics, DCF, and " +
          "sensitivity analysis are still available without it.",
      },
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

    const validation = InterpretationSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", {
        issues: validation.error.issues.map((i) => i.message),
      });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    const interpretation: ValuationInterpretation = {
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
