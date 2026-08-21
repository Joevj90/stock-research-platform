import Link from "next/link";
import { getStockSnapshot } from "@/server/market-data";
import { TickerSearch } from "@/components/TickerSearch";
import { StockChart } from "@/components/StockChart";
import { MockDataBanner } from "@/components/MockDataBanner";
import { PeriodSelector } from "@/components/PeriodSelector";
import { TechnicalAnalysisPanel } from "@/components/TechnicalAnalysisPanel";
import { FundamentalsPanel } from "@/components/FundamentalsPanel";
import { FundamentalAnalystPanel } from "@/components/FundamentalAnalystPanel";
import { NewsIntelligencePanel } from "@/components/NewsIntelligencePanel";
import { ValuationPanel } from "@/components/ValuationPanel";
import { HISTORICAL_PERIODS, type HistoricalPeriod, type StockSnapshot } from "@/lib/types";

const COMING_SOON_SECTIONS = [
  { title: "SEC Filings", detail: "10-K, 10-Q, 8-K retrieval" },
  { title: "Sentiment Agent", detail: "Dedicated sentiment scoring across sources" },
  { title: "Competitors", detail: "Qualitative competitive positioning" },
  { title: "Macro Conditions", detail: "Rates, inflation, sector context" },
  { title: "Bull / Base / Bear", detail: "Scenario analysis" },
  { title: "12-Month Forecast", detail: "Price target with confidence" },
  { title: "AI Analyst Panel", detail: "Independent multi-agent analysis" },
  { title: "Investment Committee", detail: "Cross-examines the analysts" },
  { title: "Devil's Advocate", detail: "Actively tries to disprove the thesis" },
  { title: "Final Report", detail: "Cited, confidence-scored synthesis" },
];

function parsePeriod(value: string | undefined): HistoricalPeriod {
  if (value && (HISTORICAL_PERIODS as string[]).includes(value)) {
    return value as HistoricalPeriod;
  }
  return "6M";
}

export default async function StockPage({
  params,
  searchParams,
}: {
  params: { ticker: string };
  searchParams: { period?: string };
}) {
  const period = parsePeriod(searchParams.period);
  const result = await getStockSnapshot(params.ticker, period);

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
  const { ticker, companyName, quote, history, period, provenance } = snapshot;
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

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            {period} history
          </span>
          <PeriodSelector current={period} />
        </div>

        <div className="mt-3">
          <StockChart bars={history} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Day High" value={`$${quote.dayHigh.toFixed(2)}`} />
          <Stat label="Day Low" value={`$${quote.dayLow.toFixed(2)}`} />
          <Stat label="Prev Close" value={`$${quote.previousClose.toFixed(2)}`} />
          <Stat label="Volume" value={quote.volume.toLocaleString()} />
          <Stat label="Market Cap" value={formatMarketCap(quote.marketCap)} />
          <Stat label="52-Week High" value={formatMoney(quote.week52High)} />
          <Stat label="52-Week Low" value={formatMoney(quote.week52Low)} />
          <Stat label="Avg Volume" value={quote.avgVolume ? quote.avgVolume.toLocaleString() : "—"} />
        </dl>

        <p className="mt-4 text-xs text-gray-500">
          Data as of {new Date(quote.asOf).toLocaleString()} · provider: {provenance.provider}
          {provenance.isMock ? " (mock)" : ""}
        </p>
      </section>

      <TechnicalAnalysisPanel ticker={ticker} period={period} />

      <FundamentalsPanel ticker={ticker} />

      <FundamentalAnalystPanel ticker={ticker} periodType="annual" />

      <NewsIntelligencePanel ticker={ticker} />

      <ValuationPanel ticker={ticker} />

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

function formatMoney(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function formatMarketCap(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}
