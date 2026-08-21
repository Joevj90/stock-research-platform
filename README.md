# AI Stock Research Platform — Phase 1

A ticker-driven stock research application. **This is the foundation only** —
market data retrieval, DB persistence, and a clean dashboard UI. None of the
AI analysis phases (analysts, investment committee, devil's advocate,
forecasts, sentiment, valuation, etc.) are implemented yet; the
`/api/analysis/[ticker]` endpoint honestly returns `501 Not Implemented`
rather than faking output.

## Stack

- **Next.js 14** (App Router) + **TypeScript**, strict mode
- **Prisma** + **SQLite** (swap the datasource for Postgres/MySQL later — one line in `schema.prisma`)
- **Zod** for environment validation
- **Tailwind CSS** for styling
- A dependency-free SVG chart (swap for a real charting lib when technical indicators are added)

## Getting started

```bash
npm install
cp .env.example .env        # defaults work out of the box (mock data, SQLite)
npx prisma generate
npx prisma db push          # creates dev.db with the full schema
npm run dev                 # http://localhost:3000
```

> **Note:** `prisma generate` / `prisma db push` need normal internet access
> to download Prisma's query-engine binary. If you're running this inside a
> network-restricted sandbox, that download may be blocked — it will work
> on a normal machine, CI runner, or hosting platform.

Type-check and build:

```bash
npm run typecheck
npm run build
```

## What's real vs. mock right now

- **Real (when `MARKET_DATA_PROVIDER=fmp`):** price, quote, and fundamentals
  data via Financial Modeling Prep — see "Market data layer" below.
- **Mock (default, `MARKET_DATA_PROVIDER=mock`):** all price/quote data is
  generated deterministically per ticker (same ticker → same series, within
  a run) by `MockMarketDataProvider` — it does **not** encode real facts
  about any company. Every mock response is tagged `isMock: true` and the
  dashboard shows a visible mock-data banner.

## Market data layer

Real market data is implemented via **Financial Modeling Prep (FMP)** —
see the chat writeup for the full comparison against Polygon/Massive,
Finnhub, and Alpha Vantage. Short version: FMP's `/quote` endpoint returns
price, previous close, day high/low, market cap, 52-week high/low, and
average volume in one call, and its historical-price endpoint takes an
arbitrary date range — both map directly onto this app's field and period
requirements without stitching together two vendors.

**To use real data:** get a free API key at
[financialmodelingprep.com](https://site.financialmodelingprep.com/), then
in `.env` set:
```
MARKET_DATA_PROVIDER="fmp"
FMP_API_KEY="your-key-here"
```
Leave `MARKET_DATA_PROVIDER="mock"` (the default) to keep using generated
mock data with no key required.

**Architecture — the enforced boundary:**
```
UI → API routes / server components → Market Data Service → Provider
```
`src/server/market-data/service.ts` is the *only* file allowed to import
the provider singleton (`./provider.ts`) or touch the database for market
data. The module's public barrel (`src/server/market-data/index.ts`)
deliberately exports only the service functions (`getQuote`,
`getHistoricalPrices`, `getStockSnapshot`) — never the provider or a
concrete provider class. This is what will keep the future AI analysis
layer from ever calling an external market-data API directly: it can only
go through the service, which means every AI-visible price point is
already cached, persisted, and rate-limit-safe.

**Caching:** every fetch (quote or historical) is recorded in
`MarketDataCacheEntry` with its provider, retrieval timestamp, and — for
historical data — the requested period (`1M`/`3M`/`6M`/`1Y`/`3Y`/`5Y`) and
date range. Quotes are cached for 1 minute; historical bars for 12 hours
(a closed trading day's OHLCV never changes, so there's no reason to
re-fetch it more often than that). A cache hit reads straight from
Postgres; a miss calls FMP, persists the result, and updates the cache
entry — so the same ticker+period is never re-fetched from FMP more than
once per TTL window, regardless of how many users request it.

**Provenance:** every `PriceBar` and `Quote` row stores its `provider` and
`retrievedAt`; every `MarketDataCacheEntry` row stores `provider`,
`retrievedAt`, `dataType`, and `period`. Combined with the `Stock` relation
(ticker), every piece of market data in the database is traceable to its
source, fetch time, ticker, and period.

**Swapping providers later:** implement a class satisfying
`MarketDataProvider` (`src/server/market-data/provider.interface.ts`),
register it in the factory switch in `src/server/market-data/provider.ts`,
and set `MARKET_DATA_PROVIDER` + its API key. Nothing in the service layer,
API routes, or UI needs to change — they only depend on the
`MarketDataProvider` interface and the shared `Quote`/`PriceBar` types.

## Password-protecting the site (optional)

Vercel's own password protection isn't available on the free Hobby plan
for production URLs (it requires a paid add-on), so this app has a
lightweight, self-hosted gate built in instead — free on any plan.

**To turn it on:** set a `SITE_PASSWORD` environment variable (in `.env`
locally, or in Vercel's project settings). Every page and API route will
then require that password before loading. Leave it unset to keep the app
fully open (the default).

This is a simple shared-password gate, not full user authentication — good
enough to keep a personal project off search engines and away from casual
visitors, not a substitute for real auth if this app ever holds
multi-user or sensitive data.

## Tests

```bash
npm test          # run once
npm run test:watch
```

Covers the cache freshness/period-range logic (pure functions), the FMP
provider's response parsing and error mapping (mocked `fetch`), and the
service layer's cache-hit/cache-miss/error-propagation behavior (mocked
Prisma + provider). These are unit tests — a good next step is integration
tests against a real test database.

## Deploying to Vercel

1. **Push this project to a GitHub repo** (create a new repo, then from this
   folder: `git init`, `git add .`, `git commit -m "Phase 1"`, push it up).
2. **Create a free Postgres database.** The easiest options are
   [Vercel Postgres](https://vercel.com/storage/postgres) (created from
   inside your Vercel project once step 3 is done) or
   [Neon](https://neon.tech) (works standalone, free tier). Either way you
   end up with a `DATABASE_URL` connection string.
3. **Import the repo into Vercel** at vercel.com — "Add New Project," pick
   the repo, and it will auto-detect Next.js. Don't deploy yet.
4. **Set environment variables** in the Vercel project settings, matching
   `.env.example`: at minimum `DATABASE_URL` (from step 2) and
   `MARKET_DATA_PROVIDER=mock`.
5. **Add a build step to generate Prisma's client and push the schema.**
   In `package.json`, change `"build"` to:
   `"prisma generate && prisma db push && next build"`
   (This keeps the hosted database's schema in sync with `schema.prisma` on
   every deploy — fine for this stage; a real migration workflow can replace
   `db push` with `prisma migrate deploy` later.)
6. **Deploy.** Vercel builds and gives you a live URL
   (`your-project.vercel.app`).

## Folder structure

```
prisma/schema.prisma           Stock, PriceBar, Quote, MarketDataCacheEntry,
                                Financials, Filing, NewsItem, Analysis,
                                Forecast, Source, AnalysisSource
src/
  app/
    page.tsx                   Home — ticker search
    stock/[ticker]/page.tsx    Dashboard (with period selector)
    api/
      market-data/[ticker]/    Market data namespace (?period= supported)
      analysis/[ticker]/       AI analysis namespace (stub, 501)
  server/
    market-data/
      provider.interface.ts    MarketDataProvider contract
      mock-provider.ts         Mock implementation (no API key needed)
      fmp-provider.ts          Real implementation (Financial Modeling Prep)
      provider.ts              Factory — internal, not exported publicly
      cache.ts                 Freshness + period-to-date-range (pure fns)
      service.ts               THE boundary — only file allowed to call
                                the provider or touch the DB for market data
      index.ts                 Public barrel — exports service fns only
      *.test.ts                Unit tests (Vitest)
    ai-analysis/                AI analysis stub (defines future agent contract)
    db/client.ts                 Prisma singleton
    config/env.ts                 Zod-validated env config
    logger/index.ts                Structured JSON logger
  lib/types.ts                 Shared domain types (PriceBar, Quote,
                                HistoricalPeriod, Result<T>, ...)
  components/                  TickerSearch, PriceChart, PeriodSelector,
                                MockDataBanner
```

## Roadmap (not built yet, schema/interfaces are ready for them)

Fundamentals & filings retrieval → news & sentiment → valuation → competitor
analysis → macro context → bull/base/bear scenarios → 12-month forecast →
multi-agent analyst panel → investment committee → devil's advocate →
final cited report → continuous thesis monitoring.
