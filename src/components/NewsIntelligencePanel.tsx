"use client";

import { useState } from "react";
import type { NewsEvent, NewsIntelligenceResult, Importance, NewsSentiment } from "@/lib/news-types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: NewsIntelligenceResult };

const IMPORTANCE_ORDER: Record<Importance, number> = { very_high: 0, high: 1, medium: 2, low: 3 };

const SENTIMENT_STYLE: Record<NewsSentiment, { emoji: string; color: string }> = {
  bullish: { emoji: "🟢", color: "text-up" },
  bearish: { emoji: "🔴", color: "text-down" },
  neutral: { emoji: "🟡", color: "text-yellow-400" },
};

const RECENCY_LABEL: Record<NewsEvent["recencyType"], string> = {
  recent_event: "Recent",
  ongoing_issue: "Ongoing",
  historical_background: "Background",
};

const IMPORTANCE_LABEL: Record<Importance, string> = {
  very_high: "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * On-demand (button-triggered) since it calls a paid AI API. Every event
 * shown here links back to a real source article — "Verify that every
 * article has a valid source" is enforced both by the interpreter's URL
 * check and by this UI only ever rendering `primaryArticleUrl`, which is
 * guaranteed (by the interpreter) to be a real fetched article.
 */
export function NewsIntelligencePanel({ ticker }: { ticker: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function runAnalysis() {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/news/${ticker}`);
      const body = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: body.error?.message ?? "Failed to load news." });
        return;
      }
      setState({ status: "success", data: body as NewsIntelligenceResult });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">News Intelligence</h2>
        <button
          onClick={runAnalysis}
          disabled={state.status === "loading"}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {state.status === "loading" ? "Analyzing…" : "Run Analysis"}
        </button>
      </div>

      {state.status === "idle" && (
        <p className="mt-3 text-xs text-gray-500">
          Finds recent real news about the company, groups duplicate coverage of the same story, and
          explains why each development could matter — in plain language, with links to the original
          sources.
        </p>
      )}
      {state.status === "error" && <p className="mt-3 text-sm text-red-400">{state.message}</p>}
      {state.status === "success" && <ResultView result={state.data} />}
    </section>
  );
}

function ResultView({ result }: { result: NewsIntelligenceResult }) {
  const { ticker, interpretation } = result;
  const { whatsHappening, importantEvents } = interpretation;
  const hasSummary =
    whatsHappening.positive.length > 0 || whatsHappening.negative.length > 0 || whatsHappening.neutral.length > 0;

  const sortedEvents = [...importantEvents].sort(
    (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]
  );

  return (
    <div className="mt-4 flex flex-col gap-5">
      {hasSummary && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">What&apos;s Happening With {ticker}?</h3>
          <div className="flex flex-col gap-1.5 text-sm">
            {whatsHappening.positive.map((s, i) => (
              <div key={`p-${i}`} className="text-gray-300">
                🟢 {s}
              </div>
            ))}
            {whatsHappening.negative.map((s, i) => (
              <div key={`n-${i}`} className="text-gray-300">
                🔴 {s}
              </div>
            ))}
            {whatsHappening.neutral.map((s, i) => (
              <div key={`u-${i}`} className="text-gray-300">
                🟡 {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {sortedEvents.length === 0 ? (
        <p className="text-sm text-gray-400">No notable news events found right now.</p>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {sortedEvents.map((event, i) => (
            <EventCard key={i} event={event} articles={result.articles} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        {result.articles.length} articles reviewed as of {new Date(result.fetchedAt).toLocaleString()}.
        Classification and impact are AI interpretation, not fact — click through to read the original
        source.
      </p>
    </div>
  );
}

function EventCard({
  event,
  articles,
}: {
  event: NewsEvent;
  articles: NewsIntelligenceResult["articles"];
}) {
  const primary = articles.find((a) => a.url === event.primaryArticleUrl);
  const sentiment = SENTIMENT_STYLE[event.classification];

  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <a
          href={event.primaryArticleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-gray-100 hover:underline"
        >
          {primary?.headline ?? "Source article"}
        </a>
        <div className="flex shrink-0 gap-1.5 text-[10px]">
          <span className={`rounded px-1.5 py-0.5 font-semibold uppercase ${sentiment.color} bg-black/20`}>
            {sentiment.emoji} {event.classification}
          </span>
          <span className="rounded bg-black/20 px-1.5 py-0.5 font-semibold uppercase text-gray-400">
            {IMPORTANCE_LABEL[event.importance]}
          </span>
        </div>
      </div>

      {primary && (
        <p className="mt-0.5 text-[11px] text-gray-500">
          {primary.source} · {new Date(primary.publishedAt).toLocaleDateString()} ·{" "}
          {RECENCY_LABEL[event.recencyType]}
          {event.relatedArticleUrls.length > 0 && (
            <> · +{event.relatedArticleUrls.length} more source{event.relatedArticleUrls.length > 1 ? "s" : ""}</>
          )}
        </p>
      )}

      <dl className="mt-2 flex flex-col gap-1 text-xs text-gray-400">
        <div>
          <dt className="inline font-medium text-gray-300">What happened: </dt>
          <dd className="inline">{event.whatHappened}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Why it matters: </dt>
          <dd className="inline">{event.whyItMatters}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Possible impact: </dt>
          <dd className="inline">{event.possibleStockImpact}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-300">Time frame: </dt>
          <dd className="inline">{event.timeHorizonExplanation}</dd>
        </div>
      </dl>
    </div>
  );
}
