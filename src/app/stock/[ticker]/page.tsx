import Link from "next/link";
import { getStockSnapshot } from "@/server/market-data";
import { TickerSearch } from "@/components/TickerSearch";
import { PriceChart } from "@/components/PriceChart";
import { MockDataBanner } from "@/components/MockDataBanner";
import type { StockSnapshot } from "@/lib/types";

const COMING_SOON_SECTIONS = [
  { title: "Fundamentals", detail: "Financial statements & ratios" },
  { title: "SEC Filings", detail: "10-K, 10-Q, 8-K retrieval" },
  { title: "News & Sentiment", detail: "Recent coverage, sentiment score" },
  { title: "Valuation", detail: "DCF / comps-based valuation" },
  { title: "Competitors", detail: "Peer comparison" },
  { title: "Macro Conditions", detail: "Rates, inflation, sector context" },
  { title: "Bull / Base / Bear", detail: "Scenario analysis" },
  { title: "12-Month Forecast", detail: "Price target with confidence" },
  { title: "AI Analyst Panel", detail: "Independent multi-agent analysis" },
  { title: "Investment Committee", detail: "Cross-examines the analysts" },
  { title: "Devil's Advocate", detail: "Actively tries to disprove the thesis" },
  { title: "Final Report", detail: "Cited, confidence-scored synthesis" },
];

export default async function StockPage({ params }: { params: { ticker: string } }) {
  const result = await getStockSnapshot(params.ticker);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-200">
          ← Search another ticker
        </Link>
      </div>

      <TickerSearch initialValue={params.ticker.toUpperCase()} />

      {!result.ok ? (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load {params.ticker.toUpperCase()}: {result.error.message}
        </div>
      ) : (
        <DashboardContent snapshot={result.data} />
      )}
    </main>
  );
}

function DashboardContent({ snapshot }: { snapshot: StockSnapshot }) {
  const { ticker, companyName, quote, history, provenance } = snapshot;
  const isUp = quote.change >= 0;

  return (
    <div className="flex flex-col gap-6">
      {provenance.isMock && <MockDataBanner provider={provenance.provider} />}

      <section className="rounded-xl border border-border bg-panel p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ticker}</h1>
            <p className="text-sm text-gray-400">{companyName}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">${quote.price.toFixed(2)}</div>
            <div className={`text-sm tabular-nums ${isUp ? "text-up" : "text-down"}`}>
              {isUp ? "+" : ""}
              {quote.change.toFixed(2)} ({isUp ? "+" : ""}
              {quote.changePercent.toFixed(2)}%)
            </div>
          </div>
        </div>

        <div className="mt-6">
          <PriceChart bars={history} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Day High" value={`$${quote.dayHigh.toFixed(2)}`} />
          <Stat label="Day Low" value={`$${quote.dayLow.toFixed(2)}`} />
          <Stat label="Prev Close" value={`$${quote.previousClose.toFixed(2)}`} />
          <Stat label="Volume" value={quote.volume.toLocaleString()} />
        </dl>

        <p className="mt-4 text-xs text-gray-500">
          Data as of {new Date(quote.asOf).toLocaleString()} · provider: {provenance.provider}
          {provenance.isMock ? " (mock)" : ""}
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-500">
          Coming in later phases
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMING_SOON_SECTIONS.map((s) => (
            <div
              key={s.title}
              className="rounded-lg border border-border bg-panel/60 p-4 opacity-60"
            >
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-gray-500">{s.detail}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="tabular-nums text-gray-200">{value}</dd>
    </div>
  );
}
