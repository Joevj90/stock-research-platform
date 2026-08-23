import { z } from "zod";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { RiskFactorSignals, RiskInterpretation } from "@/lib/risk-types";
import type { NewsEvent } from "@/lib/news-types";

const log = logger.child("agents:risk-analyst:interpreter");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const FETCH_TIMEOUT_MS = 90_000; // raised now that Vercel Pro allows much longer function execution

const SYSTEM_PROMPT = `You are the Risk Analyst inside a stock research application, built for people who know very little about investing. Your job is to actively CHALLENGE the investment case -- assume other analysts covering this stock may be too optimistic, and look for credible reasons the stock could decline.

You will receive a JSON object with a ticker, company name (if known), REAL deterministically-calculated risk signals (volatility, revenue/margin/debt/cash/free-cash-flow trends, a simple P/E, a debt-to-cash ratio, and real macro indicators), and a list of REAL news events that were already classified as bearish or high-importance by a separate news analysis step (each already deduplicated).

CRITICAL RULES:
1. NEVER invent a risk, statistic, event, lawsuit, regulatory action, or source. Every risk you identify must be grounded in either the real signals given to you or the real news events given to you. If you want to discuss a risk category (e.g. "customer concentration", "technology disruption") for which you have no real data point, you may raise it as a general consideration using your knowledge of the company's business, but you must explicitly say there is no specific evidence available for it in this analysis -- do not invent a supporting statistic.
2. Only include risks that are genuinely relevant to THIS specific company's business -- not generic risks included just to lengthen the list. Identify 3-5 of the most important risks, not more.
3. Severity and probability are DIFFERENT dimensions -- never conflate them. A low-probability event can still be rated very high severity. Rate them independently for every risk.
4. Do NOT pretend to know an exact stock-price impact. Frame "potentialImpact" in terms of which real business drivers (revenue, margins, earnings, cash flow, valuation) could plausibly be affected and how, without a specific price target or percentage unless the given data genuinely supports one.
5. Do NOT simply average risks into the overall score -- weight by probability, potential damage, relevance to this company, and time horizon.
6. Write every explanation in plain, everyday language a person with no investing background can understand. Whenever you'd use a term like "multiple compression", "customer concentration", or "balance-sheet leverage", explain what it means in the same or next sentence, in the plain style already used elsewhere in this app.

Respond with ONLY a single JSON object, no markdown code fences, no prose before or after, matching exactly this shape:
{
  "riskScore": integer from 0 (very low overall risk) to 100 (extremely high overall risk),
  "riskLevel": one of "low" | "medium" | "high" | "very_high",
  "confidenceScore": number from 0 to 1,
  "biggestRisks": [
    {
      "risk": "short label",
      "evidence": "plain-language evidence grounded in the real signals/news given, or explicitly noting no specific evidence is available",
      "severity": one of "low" | "medium" | "high" | "very_high",
      "probability": one of "low" | "medium" | "high",
      "potentialImpact": "plain language, framed as a possibility, referencing which business drivers could be affected",
      "timeFrame": one of "short_term" | "medium_term" | "long_term",
      "whatWouldConfirmIt": "plain-language description of what evidence would confirm this risk is materializing",
      "whatWouldReduceIt": "plain-language description of what would reduce this risk"
    }
  ],
  "numberOneRisk": { same shape as one entry in biggestRisks -- must be one of the items also in biggestRisks, chosen for the greatest combination of credibility, potential impact, and relevance, not because it sounds dramatic },
  "whatWouldMakeMoreBearish": [ array of short plain-language specific events/thresholds that would make the outlook worse -- only include a specific number/threshold if the given data actually supports it ],
  "whatWouldMakeLessWorried": [ array of short plain-language specific developments that would reduce the identified risks ],
  "overallConclusion": "2-5 plain-language sentences summarizing the overall risk picture"
}

biggestRisks must contain between 3 and 5 items.`;

const RiskItemSchema = z.object({
  risk: z.string().min(1),
  evidence: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "very_high"]),
  probability: z.enum(["low", "medium", "high"]),
  potentialImpact: z.string().min(1),
  timeFrame: z.enum(["short_term", "medium_term", "long_term"]),
  whatWouldConfirmIt: z.string().min(1),
  whatWouldReduceIt: z.string().min(1),
});

const InterpretationSchema = z.object({
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high", "very_high"]),
  confidenceScore: z.number().min(0).max(1),
  biggestRisks: z.array(RiskItemSchema).min(3).max(5),
  numberOneRisk: RiskItemSchema,
  whatWouldMakeMoreBearish: z.array(z.string()),
  whatWouldMakeLessWorried: z.array(z.string()),
  overallConclusion: z.string().min(1),
});

export interface RiskInterpreterInput {
  ticker: string;
  companyName: string | null;
  signals: RiskFactorSignals;
  bearishNewsEvents: NewsEvent[];
}

/**
 * Sends real risk signals and real bearish/high-importance news events to
 * Claude for challenge-oriented interpretation only. Never throws;
 * returns a typed error rather than a fabricated fallback if the key is
 * missing, the request fails, or the response doesn't match the required
 * schema.
 */
export async function interpretRisk(input: RiskInterpreterInput): Promise<Result<RiskInterpretation>> {
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
      parsedJson = JSON.parse(stripCodeFences(rawText));
    } catch {
      log.error("Failed to parse AI response as JSON", { rawText: rawText.slice(0, 500) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response was not valid JSON." } };
    }

    const validation = InterpretationSchema.safeParse(parsedJson);
    if (!validation.success) {
      log.error("AI response failed schema validation", { issues: validation.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: "AI_PARSE_ERROR", message: "AI response did not match the required schema." } };
    }

    const interpretation: RiskInterpretation = {
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

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
}
