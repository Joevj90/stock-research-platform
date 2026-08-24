"use client";

import { useState } from "react";
import type {
  CommitteeRecommendation,
} from "@/lib/investment-committee-types";
import type { FinalReportResult, QualityLabel } from "@/lib/final-report-types";
import type { ScenarioOutcome } from "@/lib/forecast-types";
import type { GatheredAnalysisInputs } from "@/server/agents/shared/analysis-summaries";
import type { ForecastResult } from "@/lib/forecast-types";
import type { CommitteeResult } from "@/lib/investment-committee-types";
import type { DevilsAdvocateResult } from "@/lib/devils-advocate-types";

const STEPS = [
  { key: "gather", label: "Gathering all analyses" },
  { key: "forecast", label: "Building the forecast" },
  { key: "committee", label: "Convening the investment committee" },
  { key: "devils-advocate", label: "Challenging the conclusion" },
  { key: "assemble", label: "Assembling the final report" },
] as const;

type State =
  | { status: "idle" }
  | { status: "loading"; stepIndex: number }
  | { status: "error"; message: string; failedStepIndex: number }
  | { status: "success"; data: FinalReportResult };

const RATING_STYLE: Record<CommitteeRecommendation, { label: string; color: string; bg: string }> = {
  buy: { label: "BULLISH", color: "text-up", bg: "bg-up/10" },
  hold: { label: "NEUTRAL", color: "text-gray-300", bg: "bg-gray-500/10" },
  sell: { label: "BEARISH", color: "text-down", bg: "bg-down/10" },
};

const QUALITY_STYLE: Record<QualityLabel, { label: string; color: string }> = {
  strong: { label: "STRONG", color: "text-up" },
  good: { label: "GOOD", color: "text-up" },
  average: { label: "AVERAGE", color: "text-gray-300" },
  weak: { label: "WEAK", color: "text-down" },
  very_weak: { label: "VERY WEAK", color: "text-down" },
  unavailable: { label: "N/A", color: "text-gray-600" },
};

const VALUATION_LABEL: Record<string, { label: string; color: string }> = {
  cheap: { label: "CHEAP", color: "text-up" },
  reasonably_priced: { label: "REASONABLY PRICED", color: "text-blue-400" },
  expensive: { label: "EXPENSIVE", color: "text-yellow-400" },
  very_expensive: { label: "VERY EXPENSIVE", color: "text-down" },
};

const ENV_LABEL: Record<string, { label: string; color: string }> = {
  favorable: { label: "FAVORABLE", color: "text-up" },
  neutral: { label: "NEUTRAL", color: "text-gray-300" },
  unfavorable: { label: "UNFAVORABLE", color: "text-down" },
};

async function postStep<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, message: json.error?.message ?? "This step failed." };
  }
  return { ok: true, data: json as T };
}

/**
 * The main "Final Analysis" summary, per spec. Deliberately built to be
 * readable top-to-bottom without expanding anything, with detailed
 * supporting sections collapsed by default.
 *
 * Runs as 5 separate, short-lived requests the browser orchestrates in
 * sequence (gather → forecast → committee → Devil's Advocate → assemble)
 * rather than one giant request. This app's deepest chain can, in the
 * worst case, exceed even Vercel Pro's 300-second function limit when
 * run as a single request; splitting it into steps the client drives
 * one at a time means each individual step comfortably fits within the
 * limit, even though the whole process still takes a few minutes end to
 * end — and if one step fails, only that step needs to be retried, not
 * the entire chain from scratch.
 */
export function FinalReportPanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

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

  return (
    <section className="rounded-xl border-2 border-accent/50 bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-200">Final AI Investment Report</h2>
        <button
          onClick={runReport}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Building full report…" : "Generate Final Report"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Brings together everything on this page — technical, fundamental, valuation, sentiment, macro,
          competitor, management, and risk analysis, the Forecasting Agent, the Investment Committee, and
          the Devil&apos;s Advocate — into one complete, easy-to-read report. Runs as 5 separate steps so
          progress is visible along the way; the whole process can take a few minutes.
        </p>
      )}
      {state.status === "loading" && <StepProgress currentStepIndex={state.stepIndex} failedStepIndex={null} />}
      {state.status === "error" && (
        <div className="mt-3">
          <StepProgress currentStepIndex={state.failedStepIndex} failedStepIndex={state.failedStepIndex} />
          <p className="mt-2 text-sm text-red-400">{state.message}</p>
          <p className="mt-1 text-xs text-gray-500">
            Clicking &quot;Generate Final Report&quot; will start over from the first step.
          </p>
        </div>
      )}
      {state.status === "success" && <ReportView data={state.data} />}
    </section>
  );
}

function ReportView({ data }: { data: FinalReportResult }) {
  const rating = RATING_STYLE[data.quickAnswer.rating];

  return (
    <div className="mt-5 flex flex-col gap-8">
      {/* 1. Quick Answer */}
      <div>
        {data.companyName && (
          <p className="text-sm text-gray-400">
            {data.companyName} ({data.ticker})
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div className={`rounded-lg px-4 py-2 ${rating.bg}`}>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">AI Rating</div>
            <div className={`text-xl font-bold tracking-wide ${rating.color}`}>{rating.label}</div>
          </div>
          <Stat label="Current Price" value={`$${data.quickAnswer.currentPrice.toFixed(2)}`} />
          <Stat label="Expected Price" value={`$${data.quickAnswer.expectedPrice}`} />
          <Stat
            label="Expected Return"
            value={`${data.quickAnswer.expectedReturnPct >= 0 ? "+" : ""}${data.quickAnswer.expectedReturnPct}%`}
            color={data.quickAnswer.expectedReturnPct >= 0 ? "text-up" : "text-down"}
          />
          <Stat label="Confidence" value={`${data.quickAnswer.confidenceScore}/100`} />
        </div>
        <p className="mt-3 text-sm text-gray-300">{data.quickAnswer.explanation}</p>
      </div>

      {/* 2 & 3. Why AI likes / worried */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="Why The AI Likes It" items={data.whyAiLikesIt} color="text-up" />
        <FactorList title="Why The AI Is Worried" items={data.whyAiIsWorried} color="text-down" />
      </div>

      {/* 4. Bear / Base / Bull */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bear / Base / Bull</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ScenarioCard scenario={data.bearBaseBull.bear} />
          <ScenarioCard scenario={data.bearBaseBull.base} />
          <ScenarioCard scenario={data.bearBaseBull.bull} />
        </div>
      </div>

      {/* 5. Business Quality */}
      <Section title="Business Quality">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
          <QualityCell label="Financial Health" value={data.businessQuality.financialHealth} />
          <QualityCell label="Growth" value={data.businessQuality.growth} />
          <QualityCell label="Profitability" value={data.businessQuality.profitability} />
          <QualityCell label="Competitive Position" value={data.businessQuality.competitivePosition} />
          <QualityCell label="Management" value={data.businessQuality.management} />
          <QualityCell label="Business Risks" value={data.businessQuality.businessRisks} />
        </div>
        <p className="mt-2 text-xs text-gray-400">{data.businessQuality.explanation}</p>
      </Section>

      {/* 6. Valuation */}
      <Section title="Is The Stock Cheap Or Expensive?">
        {(() => {
          const v = VALUATION_LABEL[data.valuation.rating] ?? VALUATION_LABEL.reasonably_priced!;
          return <p className={`text-sm font-bold ${v.color}`}>{v.label}</p>;
        })()}
        <p className="mt-1 text-xs text-gray-400">{data.valuation.explanation}</p>
      </Section>

      {/* 7. What's happening now */}
      {data.whatsHappeningNow.topEvents.length > 0 && (
        <Section title="What Is Happening Right Now?">
          <div className="flex flex-col gap-2">
            {data.whatsHappeningNow.topEvents.map((e, i) => (
              <a
                key={i}
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs hover:border-accent"
              >
                <div className="font-medium text-gray-100">{e.headline}</div>
                <div className="mt-0.5 text-gray-500">{e.source}</div>
                <div className="mt-1 text-gray-400">{e.whatHappened}</div>
                <div className="mt-0.5 text-gray-500">{e.whyItMatters}</div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* 8. Sentiment */}
      <Section title="Market Sentiment">
        <p className="text-xs text-gray-300">
          Direction: <span className="font-medium">{data.marketSentiment.direction}</span> · Trend:{" "}
          <span className="font-medium">{data.marketSentiment.trend}</span>
        </p>
        {data.marketSentiment.whatInvestorsLike.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-gray-400">
            {data.marketSentiment.whatInvestorsLike.map((s, i) => (
              <li key={i}>🟢 {s}</li>
            ))}
          </ul>
        )}
        {data.marketSentiment.whatInvestorsAreWorriedAbout.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
            {data.marketSentiment.whatInvestorsAreWorriedAbout.map((s, i) => (
              <li key={i}>🔴 {s}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* 9. Economy */}
      <Section title="Economy">
        {(() => {
          const e = ENV_LABEL[data.economy.environment] ?? ENV_LABEL.neutral!;
          return <p className={`text-sm font-bold ${e.color}`}>{e.label}</p>;
        })()}
        <p className="mt-1 text-xs text-gray-400">{data.economy.explanation}</p>
      </Section>

      {/* 10. Competition */}
      <Section title="Is The Company Winning?">
        <p className="text-xs text-gray-300">{data.competition.isWinning}</p>
        {data.competition.majorCompetitors.length > 0 && (
          <p className="mt-1 text-[11px] text-gray-500">
            Major competitors: {data.competition.majorCompetitors.join(", ")}
          </p>
        )}
      </Section>

      {/* 11. Management */}
      <Section title="Is Management Doing A Good Job?">
        <p className="text-xs text-gray-300">
          Assessment: <span className="font-medium uppercase">{data.management.assessment.replace("_", " ")}</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">{data.management.capitalAllocationAssessment}</p>
        <p className="mt-1 text-xs text-gray-400">{data.management.credibilityExplanation}</p>
        {data.management.concerns.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-gray-400">
            {data.management.concerns.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* 12. Biggest Risks */}
      {data.biggestRisks.length > 0 && (
        <Section title="Biggest Risks">
          <div className="flex flex-col gap-2">
            {data.biggestRisks.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-100">{r.risk}</span>
                  <span className="font-semibold uppercase text-yellow-400">{r.severity}</span>
                </div>
                <div className="mt-1 text-gray-400">{r.evidence}</div>
                <div className="mt-0.5 text-gray-500">{r.potentialImpact}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 13. Devil's Advocate */}
      <Section title="Devil's Advocate — What Could We Be Missing?">
        {data.devilsAdvocate.whatCouldWeBeMissing.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-gray-300">
            {data.devilsAdvocate.whatCouldWeBeMissing.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No significant overlooked issues identified.</p>
        )}
        <p className="mt-2 text-xs text-gray-400">{data.devilsAdvocate.strongestArgumentAgainst}</p>
        <p className="mt-2 text-xs">
          {data.devilsAdvocate.didItChangeAnything ? (
            <span className="text-yellow-300">Changed the conclusion: {data.devilsAdvocate.whatChanged}</span>
          ) : (
            <span className="text-gray-500">Did not change the conclusion.</span>
          )}
        </p>
      </Section>

      {/* 14. What would change the AI's mind */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="Would Make The AI More Bearish" items={data.whatWouldChangeAiMind.moreBearishIf} color="text-down" />
        <FactorList title="Would Make The AI Less Worried" items={data.whatWouldChangeAiMind.lessWorriedIf} color="text-up" />
      </div>

      {data.dataConsistencyNotes.length > 0 && (
        <Section title="Worth Noting">
          <div className="flex flex-col gap-2">
            {data.dataConsistencyNotes.map((n, i) => (
              <div key={i} className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-2.5 text-xs text-yellow-300">
                <span className="font-medium">{n.topic}: </span>
                {n.description}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 15. Final Conclusion */}
      <div className="rounded-lg border-2 border-accent/40 bg-bg/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bottom Line</h3>
        <p className="mt-2 text-sm text-gray-200">{data.finalConclusion.bottomLine}</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Stat label="AI Rating" value={RATING_STYLE[data.finalConclusion.rating].label} color={RATING_STYLE[data.finalConclusion.rating].color} />
          <Stat label="Confidence" value={`${data.finalConclusion.confidenceScore}/100`} />
          <Stat
            label="Expected Return"
            value={`${data.finalConclusion.expectedReturnPct >= 0 ? "+" : ""}${data.finalConclusion.expectedReturnPct}%`}
            color={data.finalConclusion.expectedReturnPct >= 0 ? "text-up" : "text-down"}
          />
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Based on the available information as of {new Date(data.generatedAt).toLocaleString()}. All figures
        are estimates that depend on the assumptions described throughout this report, not guarantees.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

function StepProgress({
  currentStepIndex,
  failedStepIndex,
}: {
  currentStepIndex: number;
  failedStepIndex: number | null;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {STEPS.map((step, i) => {
        const isDone = failedStepIndex === null ? i < currentStepIndex : i < failedStepIndex;
        const isFailed = i === failedStepIndex;
        const isActive = failedStepIndex === null && i === currentStepIndex;

        return (
          <div key={step.key} className="flex items-center gap-2 text-xs">
            <span
              className={
                isFailed
                  ? "text-down"
                  : isDone
                    ? "text-up"
                    : isActive
                      ? "text-accent"
                      : "text-gray-600"
              }
            >
              {isFailed ? "✕" : isDone ? "✓" : isActive ? "…" : "○"}
            </span>
            <span className={isDone || isActive || isFailed ? "text-gray-300" : "text-gray-600"}>
              {step.label}
              {isFailed && " — failed"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${color ?? "text-gray-100"}`}>{value}</div>
    </div>
  );
}

function FactorList({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-medium ${color}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">None identified.</p>
      ) : (
        <ul className="space-y-1 text-xs text-gray-300">
          {items.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioOutcome }) {
  const color = scenario.scenario === "bear" ? "text-down" : scenario.scenario === "bull" ? "text-up" : "text-gray-200";
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className={`text-xs font-bold uppercase tracking-wide ${color}`}>{scenario.scenario} case</span>
        <span className="text-[10px] text-gray-500">{scenario.probabilityPct}%</span>
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>${scenario.priceTarget}</div>
    </div>
  );
}

function QualityCell({ label, value }: { label: string; value: QualityLabel }) {
  const style = QUALITY_STYLE[value];
  return (
    <div className="rounded-md border border-border bg-bg/40 p-2 text-center">
      <div className="text-[9px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`font-semibold ${style.color}`}>{style.label}</div>
    </div>
  );
}
