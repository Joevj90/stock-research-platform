"use client";

import { useState } from "react";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";
import type { FinalReportResult } from "@/lib/final-report-types";

/** The 11 base analyses run in parallel as ONE server-side step
 * ("gather") rather than 11 separate client-driven requests, so their
 * real-time individual completion isn't visible to the browser -- this
 * list is shown together as what that stage covers, not tracked
 * one-by-one. Splitting "gather" into 11 separate steps was considered
 * and deliberately avoided: it would mean re-fetching News Intelligence
 * separately for each of Sentiment/Risk/the report itself instead of
 * sharing one fetch (see the Prediction Tracking cost-reduction writeup),
 * directly undermining the "do not duplicate data" requirement in
 * exchange for progress-bar granularity that isn't worth that real cost. */
export const GATHER_SUB_STEPS = [
  "Market Data",
  "Technical Analysis",
  "Fundamental Analysis",
  "News",
  "Valuation",
  "Sentiment",
  "Macro",
  "Competitors",
  "Management",
  "Risk",
] as const;

export const FINAL_REPORT_STEPS = [
  { key: "gather", label: "Gathering all analyses" },
  { key: "forecast", label: "Forecasting" },
  { key: "committee", label: "Investment Committee" },
  { key: "devils-advocate", label: "Devil's Advocate" },
  { key: "assemble", label: "Final AI Investment Report" },
] as const;

export type FinalReportGenerationState =
  | { status: "idle" }
  | { status: "loading"; stepIndex: number }
  | { status: "error"; message: string; failedStepIndex: number }
  | { status: "success"; data: FinalReportResult };

interface StepFailure {
  message: string;
  code: string | undefined;
}

async function fetchStep<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; failure: StepFailure }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, failure: { message: json.error?.message ?? "This step failed.", code: json.error?.code } };
    }
    return { ok: true, data: json as T };
  } catch {
    // fetch() itself throws on network failures, aborted connections, or
    // some timeout scenarios -- without this catch, that exception would
    // propagate uncaught and leave the UI stuck on "loading" forever with
    // no error shown, since nothing would ever update the state past the
    // in-flight step.
    return {
      ok: false,
      failure: {
        message: "This step took too long or lost connection. Try again — it sometimes finishes within the limit.",
        code: undefined,
      },
    };
  }
}

/** AI responses aren't perfectly deterministic between calls, so a
 * malformed-JSON or schema-mismatch failure on one attempt often just
 * succeeds cleanly on the next -- especially for unusual companies (e.g.
 * a leveraged ETF with no normal earnings/business story) that can
 * occasionally produce less predictable output formatting. This retries
 * ONLY the single failed step, not the whole 5-step flow, and only for
 * error codes that genuinely look content-dependent -- never for
 * AI_NOT_CONFIGURED, AI_AUTH_ERROR, etc., where retrying can't help. */
async function postStep<T>(url: string, body?: unknown, retriesLeft = 2): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const result = await fetchStep<T>(url, body);
  if (result.ok) return result;

  const retryableCodes = ["AI_PARSE_ERROR", "AI_TIMEOUT", "AI_UNREACHABLE", "AI_PROVIDER_ERROR"];
  if (retriesLeft > 0 && result.failure.code && retryableCodes.includes(result.failure.code)) {
    return postStep<T>(url, body, retriesLeft - 1);
  }

  return { ok: false, message: result.failure.message };
}

/**
 * Runs the Final Report's 5-step generation flow (gather → forecast →
 * committee → Devil's Advocate → assemble) as 5 separate, short-lived
 * requests the browser orchestrates in sequence, rather than one giant
 * request. Shared between `FinalReportPanel` (the "Generate Final
 * Report" button) and `AnalysisHistoryPanel` (the "Research Again"
 * button, Step 19) -- both need the exact same generation flow, so it
 * lives here once rather than being duplicated.
 *
 * Every successful run also permanently saves itself as a new historical
 * version (Step 19) via the assemble endpoint's own server-side hook --
 * this hook doesn't need to know that happened; it just reports the
 * finished report.
 */
export function useFinalReportGeneration(ticker: string) {
  const [state, setState] = useState<FinalReportGenerationState>({ status: "idle" });

  async function runReport() {
    setState({ status: "loading", stepIndex: 0 });

    const gatherRes = await postStep<GatheredAnalysisInputs>(`/api/final-report/${ticker}/gather`);
    if (!gatherRes.ok) {
      setState({ status: "error", message: gatherRes.message, failedStepIndex: 0 });
      return;
    }
    const gathered = gatherRes.data;

    setState({ status: "loading", stepIndex: 1 });
    const forecastRes = await postStep<ForecastResult>(`/api/final-report/${ticker}/forecast`, { gathered });
    if (!forecastRes.ok) {
      setState({ status: "error", message: forecastRes.message, failedStepIndex: 1 });
      return;
    }
    const forecast = forecastRes.data;

    setState({ status: "loading", stepIndex: 2 });
    const committeeRes = await postStep<CommitteeResult>(`/api/final-report/${ticker}/committee`, { gathered });
    if (!committeeRes.ok) {
      setState({ status: "error", message: committeeRes.message, failedStepIndex: 2 });
      return;
    }
    const committee = committeeRes.data;

    setState({ status: "loading", stepIndex: 3 });
    const daRes = await postStep<DevilsAdvocateResult>(`/api/final-report/${ticker}/devils-advocate`, {
      gathered,
      forecast,
      committee,
    });
    if (!daRes.ok) {
      setState({ status: "error", message: daRes.message, failedStepIndex: 3 });
      return;
    }
    const devilsAdvocate = daRes.data;

    setState({ status: "loading", stepIndex: 4 });
    const assembleRes = await postStep<FinalReportResult>(`/api/final-report/${ticker}/assemble`, {
      gathered,
      forecast,
      committee,
      devilsAdvocate,
    });
    if (!assembleRes.ok) {
      setState({ status: "error", message: assembleRes.message, failedStepIndex: 4 });
      return;
    }

    setState({ status: "success", data: assembleRes.data });
  }

  return { state, runReport };
}
