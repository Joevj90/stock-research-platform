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

## News Intelligence

Finds, groups, and explains recent news about a company, at
`src/server/agents/news-intelligence` (built on top of a new `src/server/
news` module — mirroring the same pattern as market-data/fundamentals).

**Integration, not duplication:** the agent calls `getCompanyNews` from
`@/server/news` — never a provider directly, never the database directly.
`src/server/news` reuses FMP (`GET /stable/news/stock?symbols=TICKER`,
confirmed against FMP's own docs) and extends the `NewsItem`/adds a
`NewsCacheEntry` model that Phase 1 had already reserved — no duplicate
schema.

**Structural anti-hallucination guardrail — this is the key design
decision of this step:** the AI is given the real fetched articles and
told to group duplicate coverage and pick the 3–7 most important events,
but every returned event's `primaryArticleUrl` (and each
`relatedArticleUrls` entry) is checked against the actual fetched article
URLs after parsing. An event referencing a URL that wasn't really
retrieved is silently dropped — see `interpreter.ts`'s verification step
and its dedicated test. This isn't just a prompt instruction; it's
enforced in code, the same way the Technical Analysis Agent enforces
"never ask the LLM to calculate" by never handing it raw prices to
compute from.

**FACT / AI INTERPRETATION / POSSIBLE IMPACT:** `NewsArticle` (the FACT
layer) is exactly what a provider returned, never touched by AI.
`whatHappened`/`whyItMatters` are the AI's interpretation.
`possibleStockImpact` is explicitly framed as a possibility in the system
prompt, never a certainty.

**Deduplication:** the AI groups articles covering the same underlying
event into one `NewsEvent` (primary + related URLs) rather than treating
every article as a separate story, so coverage volume doesn't inflate
perceived importance.

**Plain language:** every jargon term (guidance, dilutive offering,
regulatory headwinds, etc.) is explained inline, enforced by the system
prompt.

**UI:** a "What's Happening With TICKER?" 🟢🔴🟡 summary leads, then
importance-sorted event cards (each linking to its real source, showing
classification, importance, and time frame), on-demand via "Run
Analysis" since it's a paid AI call.

Try it: `GET /api/news/AAPL`.

## Fundamental Analyst AI

The first agent to interpret Step 5's financial data, at
`src/server/agents/fundamental-analyst`. Judges how financially healthy a
company appears — revenue/earnings/EPS growth, margins, free cash flow,
debt relative to earnings, ROE, ROIC, asset efficiency, and earnings
quality — from real reported data, never invented numbers.

**Integration, not duplication:** the service calls `getFundamentals` from
`@/server/fundamentals` — Step 5's own public barrel — and never imports a
provider or touches the database directly. Margins are reused from Step
5's `computeFinancialRatios`; this layer only adds what Step 5 didn't
already compute (growth rates, ROE, ROIC, debt coverage, asset turnover,
earnings quality).

**FACT / CALCULATION / AI INTERPRETATION / CONCLUSION**, mapped onto the
code:
- **FACT** — the raw reported figures in Step 5's `FinancialPeriod[]`,
  never duplicated here.
- **CALCULATION** — `CalculatedFundamentalMetrics` (`src/server/agents/
  fundamental-analyst/metrics.ts`): pure, deterministic derived numbers.
  A metric that can't be computed from the available data is `null`,
  never a guess.
- **AI INTERPRETATION** — the seven `*Assessment` fields (revenue,
  earnings, profitability, cash flow, balance sheet, growth, financial
  strength), each following the required WHAT HAPPENED? / WHY IT
  MATTERS? / IS IT GOOD OR BAD? structure.
- **CONCLUSION** — `overallConclusion`, the single synthesizing statement.

**Never invents numbers:** the system prompt (`interpreter.ts`) instructs
Claude to use only the given figures and explicitly say "Data
unavailable." for anything null, rather than filling gaps — and every
number the AI sees was computed deterministically in code before the AI
ever runs, so there's nothing for it to hallucinate from.

**Plain-language requirement:** every explanation defines financial terms
inline in the same or next sentence (e.g. "the company took on more debt
compared with the money it generates, which increases financial risk"),
enforced by the system prompt and checked by the interpreter tests.

**Scoring:** `overallFundamentalScore` (-100..100) is explicitly instructed
to weigh evidence by importance rather than average the individual
metrics, with `overallConclusion` explaining the reasoning behind it.

**UI:** the AI's conclusion, score, and positive/negative factors lead;
the seven detailed assessments come next; the full calculated numbers
table (explicitly labeled "Calculation") is tucked behind a "Show
supporting financial details" toggle so a non-expert isn't confronted
with raw ratios up front.

Try it: `GET /api/fundamental-analysis/AAPL?period=annual`, or "Run
Analysis" under Fundamental Analyst on a stock's page.

## Macro Analysis

Determines which broader economic conditions actually matter for a
specific company — not a generic economic report — at
`src/server/agents/macro-analysis`, built on a new small data domain at
`src/server/macro`.

**A genuinely new data domain, handled correctly:** economic indicators
(GDP growth, inflation/CPI, unemployment rate, the 10-year Treasury
yield as an interest-rate proxy) aren't tied to any specific company —
they're the same for every ticker. Rather than shoehorning them into the
existing per-stock caching pattern, `src/server/macro/service.ts` uses a
simple in-memory, process-wide cache instead of a database table — the
architecturally correct shape for global data, and it avoids an
unnecessary schema change. Real data via FMP's Economic Indicators and
Treasury Rates endpoints, each figure retaining its source, URL,
publication date, and retrieval date (see `MacroIndicator` in
`src/lib/macro-types.ts`).

**Company-specific by construction:** the agent pulls the company name
via `getStockSnapshot` (Step 1, free, no new data source) and passes both
the ticker and real indicators to the AI, instructed that its whole job
is "which of these conditions matter for THIS company" — not to force
every indicator into the analysis. The AI is explicitly permitted to use
its general knowledge of what business a company is in (that a bank
cares about interest rates and credit conditions, a retailer cares about
consumer spending, differently than an oil company cares about commodity
prices) to judge relevance — but is barred from fabricating any specific
economic statistic beyond what it was actually given.

**FACT / CALCULATION / AI INTERPRETATION / FORECAST:** the indicators
are FACT (sourced, dated, real). There's no numeric derivation step in
this agent (macro figures are used as-is), so nothing here is presented
as a FORECAST — `timeHorizon` and risk descriptions are framed as
possibilities. Only the relevance judgment, score, and explanations are
AI INTERPRETATION.

**Score is not an average:** the system prompt explicitly instructs
weighting factors by how much they matter to this specific company
rather than averaging every given indicator equally.

**UI:** FAVORABLE/NEUTRAL/UNFAVORABLE + score lead, then "What's
Helping?" / "What's Hurting?", the single biggest economic risk
highlighted, then 2-5 other risks to watch — deliberately light on raw
statistics, per the spec.

Try it: `GET /api/macro/JPM` (works for any ticker, but the answer will
differ meaningfully by company — e.g. interest rates matter far more for
a bank than for a retailer).

## Sentiment Analysis

Judges how investors currently feel about the company, at
`src/server/agents/sentiment-analysis`. The central design decision of
this step: it does NOT re-fetch or re-classify news — it builds directly
on Step 7's News Intelligence output, which already deduplicates and
classifies coverage into important events. That's what guarantees
duplicate coverage of the same story can't distort the sentiment score —
the dedup already happened one layer down.

**Integration, not duplication:**
- Calls `runNewsIntelligence` from `@/server/agents/news-intelligence`
  (Step 7) for already-classified, already-deduplicated news events.
- Computes market-reaction stats (`recentPriceChangePct`,
  `volumeVsAverage`) using the exact same pure functions
  (`rateOfChange`, `volumeTrend`) the Technical Analysis Agent already
  uses from `src/lib/technical-indicators.ts` — not reimplemented.
- Computes a lightweight, free fundamentals signal (recent revenue/net
  income growth, a simple P/E) directly from Step 5's real data via
  `getFundamentals`, specifically so comparing sentiment against reality
  doesn't require paying for a second full Fundamental Analyst or
  Valuation Engine AI run.
- Degrades gracefully: if market data or fundamentals are unavailable
  (e.g. an FMP plan limit), sentiment still gets calculated from news
  alone rather than failing outright.

**FACT / SOURCE-BASED SENTIMENT / AI INTERPRETATION / CONCLUSION:** the
news events this agent receives are treated as SOURCE-BASED SENTIMENT
(what sources are already saying, already classified) — not as this
agent's own opinion, and not as FACT. The market-reaction and
fundamentals numbers are FACT-derived CALCULATION. Only the score,
trend, and comparisons are AI INTERPRETATION.

**No social media data source is integrated** — the system prompt
explicitly instructs the model not to reference social platforms as if
it had real data from them, since none is ever supplied. This makes "social
media opinions treated as fact" structurally impossible rather than just
discouraged.

**Score is not a simple count:** the system prompt explicitly instructs
weighing by importance, recency, and strength rather than counting
positive vs. negative events, and explicitly asks the model to flag
mismatches between sentiment and reality (e.g. sentiment improving while
the stock falls, extreme optimism despite an expensive P/E).

**UI:** BULLISH/BEARISH/NEUTRAL + score lead, then "What People Like" /
"What People Are Worried About", sentiment trend, and three reality-check
comparisons (market reaction, sentiment vs. fundamentals, sentiment vs.
price) — all traced back to the real news events and real numbers behind
them.

Try it: `GET /api/sentiment/AAPL`.

## Valuation Engine

Estimates whether a stock looks cheap, reasonably priced, expensive, or
very expensive, at `src/server/agents/valuation-engine`. Built entirely
on real data already fetched by earlier steps — no new data domain, no
duplicate systems.

**Integration, not duplication:** calls only `getQuote`,
`getHistoricalPrices` from `@/server/market-data` and `getFundamentals`
from `@/server/fundamentals` — the same public barrels every other agent
uses. The one small addition was `getPeerSymbols` on the market-data
provider interface (real FMP peer-company data), added the same way
`getQuote`/`getHistory` already exist there.

**FACT / CALCULATION / ASSUMPTION / FORECAST / AI INTERPRETATION**,
concretely:
- **FACT** — current price, market cap, reported financials (Steps 1 & 5),
  never restated here.
- **CALCULATION** — `ValuationMetrics` (P/E, PEG, EV/EBITDA, EV/Revenue,
  P/S, P/B, FCF yield, dividend yield — each explicitly null with a
  stated reason when not meaningful, e.g. negative earnings),
  `HistoricalComparison` (today's multiples vs. the company's own past,
  computed from existing price + fundamentals history), `PeerComparison`
  (real peer tickers' multiples, averaged), and the `SensitivityRow`s —
  all deterministic, zero AI.
- **ASSUMPTION** — `DcfAssumptions`: explicit, labeled, never presented
  as fact. The base case is anchored on the company's own recent
  growth/margin rather than arbitrary numbers; bear/bull are
  systematically more conservative/optimistic from there — "Do not
  choose assumptions simply to justify the current stock price."
- **FORECAST** — each DCF scenario's fair value per share: a model
  output under stated assumptions, explicitly not a prediction.
- **AI INTERPRETATION** — the CHEAP/REASONABLY_PRICED/EXPENSIVE/
  VERY_EXPENSIVE rating, plain-language explanation, biggest-uncertainty
  callout, and per-assumption explanations — tagged `source: "ai"`,
  never computing a number itself.

**DCF math is 100% deterministic backend code** (`dcf.ts`) — bear/base/
bull scenarios, Gordon Growth terminal value, net-debt adjustment, and a
4-dimension sensitivity grid (revenue growth, margin, discount rate,
terminal growth), all pure functions with directional sanity tests
(e.g. confirmed: lower discount rate → higher fair value, more debt →
lower equity value). The AI interpreter never touches this math — it
only reads the finished numbers.

**Peer comparison is not the Competitor Agent** (that's still a later,
deferred step) — this only pulls real peer tickers' current valuation
multiples via infrastructure that already exists and averages them
numerically, the way a quick comps table would, with no qualitative
competitive narrative.

**UI:** current price and rating lead, followed by the plain-language
explanation and biggest uncertainty, then metrics, historical/peer
comparison, DCF range with bear/base/bull cards, assumption explanations,
and sensitivity analysis behind a toggle — all 10 required sections, most
important first.

Try it: `GET /api/valuation/AAPL`.

## Fundamental Financial Data

The financial-statement data layer, at `src/server/fundamentals`. Retrieves
real income statement, balance sheet, and cash flow statement data (income
statement: revenue, gross profit, operating income, net income, EPS;
balance sheet: cash, total assets, total liabilities, debt, shareholders'
equity; cash flow: operating cash flow, capex, free cash flow), stores
history so trends can be tracked, and turns it into everyday-language
summaries — without any AI involved. (The Fundamental Analyst agent that
will eventually interpret this data is a separate, later step.)

**Architecture** mirrors `market-data` exactly on purpose:
`FundamentalsProvider` interface → mock/FMP implementations → factory →
`service.ts` (the only file allowed to call the provider or touch the DB)
→ a restricted public barrel. Set `FUNDAMENTALS_DATA_PROVIDER=fmp` in
`.env` to use real data (reuses the same `FMP_API_KEY` as market data —
no new key needed); the default `mock` generates internally-consistent
fake financials with no key required.

**Provenance:** every stored period carries `source`, `filingDate`,
`reportingPeriodEnd`, `fiscalYear`, `fiscalQuarter`, and `retrievedAt`.
Annual and quarterly periods are never mixed — `periodType` is part of
the database's uniqueness constraint and every query.

**Validation** (`validate.ts`) runs deterministic sanity checks on every
period — does the balance sheet actually balance, does free cash flow
roughly equal operating cash flow minus capex, is gross profit ≤ revenue,
is the reporting date plausible — and flags issues without ever
discarding data. See `FundamentalsResult.periods[].warnings`.

**Normalization for comparability** (`ratios.ts`): gross/operating/net
margin and debt-to-equity, computed as plain percentages/ratios so two
companies of very different size are directly comparable — pure
arithmetic, never AI-derived.

**Plain-English explanations** (`explain.ts`): rule-based, NOT
AI-generated — "Revenue has grown steadily (+15% over this period).
Since more revenue generally means the business is doing better, this is
generally a good sign." Precision is preserved in `values` (the raw
numbers); only `explanation` is simplified. Debt is treated as
ambiguous ("isn't automatically bad") rather than automatically negative,
matching the "more debt ≠ automatically bad" instruction this layer was
built to follow.

**UI:** the `FundamentalsPanel` component shows trend summaries
("$100B → $115B → $130B" plus a one-line explanation) rather than raw
statement tables, with an Annual/Quarterly toggle. It's on-demand (a
button), not automatic, to conserve the FMP free-tier request budget —
each load fetches three statements at once but is cached 24h afterward.

Try it: `GET /api/fundamentals/AAPL?period=annual`.

## Technical Analysis Agent

The first real AI agent in the app, at `src/server/agents/technical-analysis`.
It computes standard technical indicators deterministically from real
historical prices, then asks Claude to interpret (never calculate) those
numbers into a qualitative reading.

**Calculated (deterministic, zero AI involvement)** — see
`src/lib/technical-indicators.ts`:
SMA 20/50/100/200, EMA 20, RSI 14, MACD(12,26,9), Bollinger Bands(20,2),
ATR 14, volume trend, annualized volatility, 10-day rate of change, and
swing-based support/resistance levels.

**AI interpretation** — see
`src/server/agents/technical-analysis/interpreter.ts`: sends only the
already-calculated numbers to Claude (`claude-sonnet-5`) with an explicit
instruction not to compute or invent any numeric value, and validates the
response against a strict schema (Zod) before accepting it — trend,
momentum, bullish/bearish signals, a -100..+100 technical score, and a
plain-English explanation.

The result type keeps these two halves structurally separate
(`calculated.source === "calculated"`, `interpretation.source === "ai"`),
and the `TechnicalAnalysisPanel` UI component visually separates them too,
so it's never ambiguous which numbers were computed in code vs. framed by
the model.

**Architecture:** the agent fetches price history exclusively through
`getHistoricalPrices` from `@/server/market-data` — the same public
service barrel everything else uses — never a provider directly. That's
what keeps `UI → Backend → Market Data Service → Provider` true even as
AI agents get added on top.

**To use it:** set `ANTHROPIC_API_KEY` in `.env` (or Vercel). Without it,
`/api/technical-analysis/[ticker]` returns `501` with a clear
`AI_NOT_CONFIGURED` message — the calculated metrics are still fully
computed, just not interpreted, since fabricating a fallback
interpretation would defeat the point.

Try it: `GET /api/technical-analysis/AAPL?period=1Y`, or click "Run
Analysis" on a stock's dashboard page (it's on-demand, not automatic,
since it calls a paid AI API on every run).

## Tests

```bash
npm test          # run once
npm run test:watch
```

Covers the cache freshness/period-range logic (pure functions), the FMP
provider's response parsing and error mapping (mocked `fetch`), the
service layer's cache-hit/cache-miss/error-propagation behavior (mocked
Prisma + provider), every technical indicator formula, the Technical
Analysis Agent's calculation/interpretation/error-handling behavior
(mocked market-data service + Anthropic API), the fundamentals layer's
validation rules, ratio math, plain-English explanation generation, FMP
statement parsing, and service orchestration, the Fundamental Analyst's
growth/ROE/ROIC/earnings-quality calculations and AI schema validation,
the News Intelligence agent's FMP news parsing, service orchestration,
and — notably — its anti-hallucination URL-verification guardrail, and
the Valuation Engine's ratio math, historical/peer comparison, and —
notably — 19 tests on the DCF engine alone (including directional sanity
checks like "lower discount rate must produce a higher fair value"), and
the Sentiment Analysis agent's reuse of shared indicator functions, its
graceful degradation when supporting data is unavailable, and its AI
schema validation, and the Macro Analysis agent's real-indicator
provenance, in-memory cache behavior, and company-specific relevance
enforcement (281 tests total). These are unit tests — a good next
step is integration tests against a real test database.

**Note on schema changes:** the build command uses `prisma db push
--accept-data-loss`. This is appropriate here because `PriceBar`/`Quote`
rows are a re-fetchable cache, not primary data — if a schema change ever
requires dropping a column with existing data, losing cached price history
is harmless (it's refetched from the provider on the next request). If
this app later stores data that must never be dropped without review,
switch to `prisma migrate deploy` with reviewed migration files instead.

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
