"use client";

import { useState } from "react";
import type {
  AnalystPersona,
  CommitteeRecommendation,
  CommitteeResult,
  DebateExchange,
  PersonaEvaluation,
} from "@/lib/investment-committee-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: CommitteeResult };

const PERSONA_LABEL: Record<AnalystPersona, string> = {
  value_investor: "Value Investor",
  growth_investor: "Growth Investor",
  momentum_trader: "Momentum Trader",
  risk_averse_investor: "Risk-Averse Investor",
  contrarian_investor: "Contrarian Investor",
};

const RECOMMENDATION_STYLE: Record<CommitteeRecommendation, { label: string; color: string; bg: string }> = {
  buy: { label: "BULLISH", color: "text-up", bg: "bg-up/10" },
  hold: { label: "NEUTRAL", color: "text-gray-300", bg: "bg-gray-500/10" },
  sell: { label: "BEARISH", color: "text-down", bg: "bg-down/10" },
};

/**
 * The main summary users see after the individual research sections, per
 * spec. On-demand (button-triggered) since it's the most elaborate
 * synthesis in the app — two AI calls of its own, built on the same 8
 * agents Forecasting Agent uses. Leads with "What The AI Thinks" and the
 * rating; supporting detail (persona-by-persona votes, debate, full
 * disagreement list) is available but collapsed by default.
 */
export function InvestmentCommitteePanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [showDetail, setShowDetail] = useState(false);

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/investment-committee/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Investment committee failed." });
        return;
      }
      setState({ status: "success", data: body as CommitteeResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border-2 border-accent/40 bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          AI Investment Committee
        </h2>
        <button
          onClick={runAnalysis}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Committee deliberating…" : "Convene Committee"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Five analyst personas with different philosophies (value, growth, momentum, risk-averse,
          contrarian) independently review every real analysis on this page, then debate their
          disagreements to reach a final view. This is the most thorough analysis in the app — it can
          take a minute or more.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && (
        <ResultView result={state.data} showDetail={showDetail} setShowDetail={setShowDetail} />
      )}
    </section>
  );
}

function ResultView({
  result,
  showDetail,
  setShowDetail,
}: {
  result: CommitteeResult;
  showDetail: boolean;
  setShowDetail: (v: boolean) => void;
}) {
  const { interpretation } = result;
  const style = RECOMMENDATION_STYLE[interpretation.finalRecommendation];

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-xs font-semibold text-gray-200">What The AI Thinks</h3>
        <p className="text-sm text-gray-200">{interpretation.overallConclusion}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg/40 p-4">
        <div className={`rounded-lg px-4 py-2 ${style.bg}`}>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">AI Rating</div>
          <div className={`text-lg font-bold tracking-wide ${style.color}`}>{style.label}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Confidence</div>
          <div className="text-lg font-semibold tabular-nums text-gray-100">{interpretation.finalConfidence}/100</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Committee Vote</div>
          <div className="text-sm tabular-nums text-gray-300">
            {interpretation.voteTally.buy} buy · {interpretation.voteTally.hold} hold ·{" "}
            {interpretation.voteTally.sell} sell
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">{interpretation.recommendationRationale}</p>

      {interpretation.minorityViewWorthConsidering && (
        <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-3 text-xs text-yellow-300">
          <span className="font-semibold">Worth considering: </span>
          {interpretation.minorityViewWorthConsidering}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FactorList title="Reasons To Be Optimistic" items={interpretation.keyAgreements} color="text-up" />
        <FactorList
          title="Reasons To Be Careful"
          items={interpretation.keyDisagreements.map((d) => `${d.topic}: ${d.description}`)}
          color="text-down"
        />
      </div>

      <div>
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {showDetail ? "Hide" : "Show"} full committee detail (persona votes, debate, disagreements)
        </button>
        {showDetail && <DetailView interpretation={interpretation} />}
      </div>
    </div>
  );
}

function DetailView({ interpretation }: { interpretation: CommitteeResult["interpretation"] }) {
  return (
    <div className="mt-4 flex flex-col gap-5 border-t border-border pt-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold text-gray-200">Persona-by-Persona Evaluations</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {interpretation.personaEvaluations.map((p) => (
            <PersonaCard key={p.persona} persona={p} />
          ))}
        </div>
      </div>

      {interpretation.debateExchanges.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-gray-200">Debate</h3>
          <div className="flex flex-col gap-2">
            {interpretation.debateExchanges.map((e, i) => (
              <ExchangeCard key={i} exchange={e} />
            ))}
          </div>
        </div>
      )}

      {interpretation.keyDisagreements.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-gray-200">Full Disagreement Detail</h3>
          <div className="flex flex-col gap-2">
            {interpretation.keyDisagreements.map((d, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
                <div className="font-medium text-gray-200">{d.topic}</div>
                <div className="mt-1 text-gray-400">{d.description}</div>
                <div className="mt-1 text-gray-500">{d.sidesSummary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaCard({ persona }: { persona: PersonaEvaluation }) {
  const style = RECOMMENDATION_STYLE[persona.recommendation];
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-200">{PERSONA_LABEL[persona.persona]}</span>
        <span className={`font-semibold uppercase ${style.color}`}>
          {persona.recommendation} · {persona.confidence}%
        </span>
      </div>
      <p className="mt-1 text-gray-500">{persona.whatTheyWeighMost}</p>
      {persona.keyReasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-gray-400">
          {persona.keyReasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExchangeCard({ exchange }: { exchange: DebateExchange }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
      <p>
        <span className="font-medium text-gray-200">{PERSONA_LABEL[exchange.personaA]}: </span>
        <span className="text-gray-400">{exchange.challenge}</span>
      </p>
      <p className="mt-1.5">
        <span className="font-medium text-gray-200">{PERSONA_LABEL[exchange.personaB]}: </span>
        <span className="text-gray-400">{exchange.response}</span>
      </p>
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
          {items.slice(0, 5).map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
