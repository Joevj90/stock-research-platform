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

## Analysis History & Reassessment

Lets the user manually re-research a stock at any time and see exactly
what changed since last time, at `src/server/analysis-history`.
Explicitly **not** continuous or automatic — "do NOT build continuous
background monitoring... only retrieve current information when the
user explicitly clicks Research Again."

**"Research Again" reuses the real Final Report flow, adding no new
analysis logic of its own:** the 5-step generation sequence (gather →
forecast → committee → Devil's Advocate → assemble) that
`FinalReportPanel` already used was extracted into a shared hook
(`useFinalReportGeneration`) specifically so this step's "Research
Again" button could reuse the exact same real flow rather than
duplicating it. Both components now use the identical hook; nothing
about how a Final Report gets generated changed.

**Saving happens automatically, with no new user-facing step:** the
existing `/api/final-report/[ticker]/assemble` route was extended
(one `await saveAnalysis(...)` call) to permanently record every
completed Final Report as a new, immutable historical version the
moment it finishes. "Research Again" is genuinely just "run Final
Report again" — the history and comparison are a byproduct of that,
not a separate expensive step.

**Immutability, enforced structurally:** `save-service.ts` only ever
calls `prisma.savedAnalysis.create` — there is no `update` call
anywhere in this module, so it is structurally impossible for a saved
analysis to be modified after the fact. A dedicated test confirms this.
Each `SavedAnalysis` row stores both the individual comparable fields
(for fast history-table queries) and the complete verbatim
`FinalReportResult` as JSON (so "view the report exactly as it was" is
always available) — a deliberate, query-driven duplication, not an
accidental one.

**Comparison is free until there's something to compare:** viewing
history never makes an AI call when 0 or 1 analyses exist for a ticker.
Once 2+ exist, comparing the two most recent triggers exactly one
focused AI call (`comparison-interpreter.ts`) — deliberately smaller
and cheaper than a full analysis, since its only job is explaining a
diff between two already-complete real conclusions, not forming a new
one. A dedicated test confirms history is still returned even if this
comparison call fails.

**"Do NOT change the rating simply because the stock price changed" is
enforced at two levels:** the deterministic `computeComparisonDeltas`
only ever *reports* price/confidence/return deltas, never judges them —
and the AI prompt explicitly requires separating what changed because
of the **stock price** (the market re-pricing the same expectations)
from what changed because of the **business** (the actual outlook
changing), a distinction shown as two separate sections in the UI.

**FACT / CALCULATION / AI INTERPRETATION:** every field on a saved
analysis is FACT (copied verbatim from a real completed report, never
re-derived); the price/rating/confidence deltas are CALCULATION (pure
arithmetic, `comparison-calculations.ts`); the "what changed and why it
matters" narrative, thesis-change classification, and price-vs-business
separation are AI INTERPRETATION.

**UI:** "Research Again" is the main action; the history table shows
date/rating/expected price/confidence/stock price for every saved
version with a "View" link that opens the exact historical report
(price/rating/bottom line/committee conclusion/Devil's Advocate finding,
unchanged since the moment it was generated); a comparison card shows
before/after, "What Changed Since Your Last Analysis," the thesis-change
verdict, price-vs-business separation, and What Improved/Got Worse/
Stayed The Same; a simple month-grouped timeline shows how the rating
evolved.

Try it: `GET /api/analysis-history/AAPL` (once at least one Final
Report has been generated for that ticker).

## Prediction Tracking & Accuracy

Permanently records every forecast the app makes and grades it against
what actually happened, at `src/server/predictions`. Genuinely different
in character from every other step — this is a data-integrity and
statistics system, not an AI agent; it makes no AI calls at all.

**Immutability is the whole point of this step, and it's enforced
structurally, not just by convention:** `recordPredictionsFromForecast`
writes the original prediction fields exactly once, at creation.
`evaluatePendingPredictions` can only ever fill in the initially-null
evaluation columns (`actualPrice`, `evaluatedAt`, `actualReturnPct`,
`predictionErrorAbs/Pct`, `directionCorrect`, `rangeOutcome`) on a row —
there is no code path anywhere in this module capable of rewriting an
original prediction's price targets, probabilities, or assumptions. A
dedicated test asserts the exact list of fields an evaluation update
touches and confirms it never includes an original field.

**No look-ahead bias:** a prediction is only evaluated once its horizon
has genuinely elapsed (`isReadyForEvaluation`, checked both in the DB
query and again defensively in code) — a dedicated test confirms a
12-month prediction made today is correctly still "not ready" after only
one month has passed, directly from the spec's own example.

**Hooked in without touching Forecasting Agent itself:** rather than
modifying Step 14's tested, deployed service to also persist data,
recording happens at the API boundary
(`src/app/api/forecast/[ticker]/route.ts`) — "whenever a completed stock
analysis produces a forecast" is satisfied at the most direct point a
forecast is actually delivered, and Forecasting Agent's own service.ts
is completely unchanged. A 24-hour dedup window prevents the table
filling with near-duplicate rows from repeated re-runs, without ever
touching a record that's already there.

**All arithmetic is deterministic** (`calculations.ts`) — actual return,
prediction error (absolute and %), direction correctness (with a small
threshold so near-zero moves aren't misclassified as a "wrong" direction
call), which bear/base/bull range the actual price landed in, and every
aggregate accuracy statistic. 36 dedicated tests cover this math.

**No misleading percentages from small samples:** overall accuracy,
per-horizon accuracy, and confidence calibration are all gated behind
minimum sample sizes (5, 3, and 10 evaluated predictions respectively) —
below the threshold, the UI shows an honest "not enough data" message
instead of a percentage.

**Confidence calibration** compares the AI's average stated confidence
against its actual accuracy and explicitly says when the AI is more
confident than its results justify.

**Simulated performance is clearly labeled as simulated** — "SIMULATED /
HISTORICAL — NOT ACTUAL TRADING RESULTS" — never presented as real
trading returns, per the spec's explicit warning that accuracy and
profitability are different things.

**A pragmatic scope note:** the spec lists four horizons (1/3/6/12
month), but Forecasting Agent only produces three (3/6/12 month) — this
step tracks exactly those three rather than fabricating a 1-month
prediction Forecasting Agent never actually made. Similarly, the 5-way
AI rating (STRONG_BULLISH...STRONG_BEARISH) this step needs is derived
deterministically from Forecasting Agent's own real expected return and
confidence score (`deriveFiveWayRating`) rather than depending on the
full Investment Committee/Devil's Advocate chain, keeping prediction
recording cheap and independent of the app's most expensive endpoints.

**UI:** a real SVG chart plotting each prediction's starting price, AI
target, and actual outcome over time (color-coded correct/wrong), a
per-ticker history table, and an app-wide accuracy dashboard (overall
accuracy, by-horizon accuracy, confidence calibration, simulated
performance) — all gated behind the same honest sample-size thresholds
as the backend.

Try it: `GET /api/predictions/AAPL` (per-ticker history) and
`GET /api/predictions/accuracy` (global dashboard) — both trigger
evaluation of any newly-due predictions first.

## Final AI Investment Report

The main "Final Analysis" page — everything the app has analyzed, brought
together into one report, at `src/server/agents/final-report`.

**Genuinely different in character from every other synthesis step: this
one makes NO new AI call at all.** The spec is explicit — "do not
independently calculate new financial metrics unless necessary" and "use
the existing outputs" — so this service is pure deterministic assembly:
every section either copies real data directly from an existing agent's
output, or applies a deterministic label (`labels.ts`) to a real score
that agent already computed (e.g. -100..100 → STRONG/GOOD/AVERAGE/WEAK/
VERY_WEAK). `labels.ts` never guesses a label for missing data — a null
score always maps to "unavailable", never a fabricated middle value.

**Zero added AI-call cost beyond Devil's Advocate's own chain:** this
service gathers the 8-agent evidence exactly once and feeds it into
`runForecast`, `runInvestmentCommittee`, and `runDevilsAdvocate` via
their `precomputed`/`precomputedGathered` parameters — the last of these
(`DevilsAdvocatePrecomputed`) was added this step specifically so Final
Report could reuse Devil's Advocate's exact chain (gather → Forecast →
Committee → critique) at no extra cost, and Devil's Advocate's own result
type was extended to expose the full underlying `gathered`/`forecast`/
`committee` objects it already had in scope but wasn't returning before.
A dedicated test confirms `gatherAnalysisSummaries` is called exactly
once for a full report generation. The one genuinely new call is
`runNewsIntelligence` — section 7 needs real article URLs the shared
gatherer's compact summaries never carried.

**The Devil's Advocate's revision, when there is one, wins:** the
report's headline rating/confidence reflect `committeeReview.wasThesisRevised`
— if the Devil's Advocate's critique was strong enough to change the
Investment Committee's mind, the Final Report shows the *revised*
conclusion, not the stale original.

**Real (if simple) cross-agent consistency checking:** rather than
silently picking a number when agents' real conclusions are in tension,
`buildDataConsistencyNotes` flags a checkable case — e.g. Valuation rating
"expensive" alongside a strongly positive expected return — and explains
what it means, satisfying "identify the conflict... explain the
discrepancy when important" without inventing a resolution.

**Never presented as certain:** every price is explicitly framed as an
estimate (reusing Forecasting Agent's already-rounded, no-false-precision
figures), and the bottom line explicitly names "the biggest uncertainty."

**UI:** designed to be read top-to-bottom without expanding anything —
quick answer, why-liked/why-worried, bear/base/bull, business quality,
valuation, what's happening now (with real source links), sentiment,
economy, competition, management, biggest risks, Devil's Advocate summary,
what would change the AI's mind, and the bottom line — all sourced from
real, already-computed data.

Try it: `GET /api/final-report/AAPL` (expect this to take at least as
long as Devil's Advocate alone, since it depends on that exact chain).

## Devil's Advocate

Challenges the Investment Committee's actual conclusion — "why might we
be wrong?" — at `src/server/agents/devils-advocate`, placed near the
Committee in the UI per spec.

**A real cost-control refactor, verified before use:** this agent needs
both Forecasting Agent's and the Investment Committee's real conclusions,
plus the same 8-agent evidence both of those already gathered. Rather
than letting three separate 8-agent gathers happen (Forecast's internal
one, Committee's internal one, and a third for this agent), `runForecast`
and `runInvestmentCommittee` were extended with an optional
`precomputedGathered` parameter — additive and backward-compatible, and
their full existing test suites were re-verified (plus new dedicated
tests confirming the parameter actually skips the internal re-gather)
before this agent was built on top of it. Devil's Advocate now gathers
evidence exactly once and hands it to both.

**Not automatically bearish — enforced as a hard rule and checked at the
schema level:** `overallChallengeScore` measures how strongly the
*current* thesis should be challenged, whether that thesis is bullish or
bearish — a well-supported conclusion of either direction can score low.
The system prompt states this explicitly and repeatedly.

**No unjustified revisions:** the "send findings back to the Investment
Committee" requirement is handled by the same AI call that produces the
critique (it already has full context of both), but the schema enforces
a bidirectional consistency check — `wasThesisRevised: true` requires a
non-null revised rating/confidence/explanation, and `false` requires them
to be null. A dedicated test confirms the schema catches a response that
claims a revision without actually providing one (or vice versa) — this
is exactly the kind of AI-response bug that would otherwise let a
"cosmetic" revision slip through undetected.

**Honest about what it can and can't do:** this app has no
period-by-period historical dataset for Devil's Advocate to draw on —
only the same compact summaries Forecast/Committee use. The system prompt
explicitly bars inventing specific past events, dates, or figures for
historical comparison; it may only reason from what it was actually
given.

**FACT / CALCULATION / ASSUMPTION / AI INTERPRETATION / CHALLENGE / FINAL
CONCLUSION:** the real Committee/Forecast conclusions are FACT; no new
numbers are calculated in this step; `questionableAssumptions` are
explicit ASSUMPTIONs, never fact; the critique content is AI
INTERPRETATION; `overallChallengeScore`/`challengeLevel` are explicitly
the CHALLENGE (not a bearish score); `finalConclusion` and
`committeeReview` are the FINAL CONCLUSION, never presented as more
certain than the evidence supports.

**UI:** challenge level and score lead, then weaknesses, the single
assumption that worries it most, alternative interpretations, and a
clear YES/NO/POSSIBLY on whether the rating could change — with the
Investment Committee Review showing plainly whether anything actually
changed, and why (or why not).

Try it: `GET /api/devils-advocate/AAPL` (expect this to be the single
slowest endpoint in the app — it depends on both Forecast's and the
Committee's full pipelines plus its own critique call).

## AI Investment Committee

The main summary users see after the individual research sections, at
`src/server/agents/investment-committee` — five analyst personas with
distinct philosophies independently review the real evidence, then
debate and reach a final rating.

**A second top-level synthesis agent, architecturally parallel to
Forecasting Agent, not nested inside it:** both use the same shared
`gatherAnalysisSummaries` (`src/server/agents/shared/analysis-summaries.ts`)
to call the 8 underlying analysis agents (Technical, Fundamental,
Valuation, Sentiment, Macro, Competitor, Management, Risk) — extracted
this step specifically so Forecasting and the Committee don't duplicate
that gathering logic between them. (Refactoring Forecasting Agent's
service to use the shared gatherer was verified against its full
existing test suite before this step continued — nothing broke.)

**Two AI calls, not six:** rather than one API call per persona plus a
separate consensus call, Phase 1 (`personas-interpreter.ts`) generates
all five personas' independent evaluations in a single structured call —
the system prompt explicitly forbids restating the same recommendation
five times and requires each persona's philosophy to genuinely drive
different conclusions when the evidence supports it. Phase 2
(`debate-interpreter.ts`) receives Phase 1's five evaluations as FIXED
input (it cannot alter what they already concluded) and produces debate
exchanges, agreement/disagreement analysis, and the final synthesized
recommendation.

**Vote counting is never trusted to the AI:** `vote-tally.ts` counts how
many personas voted buy/hold/sell in code — pure counting, the same
"verify calculations programmatically" principle Forecasting Agent
applies to its probability math. The AI's `finalRecommendation` is
explicitly NOT required to match the simple majority — the system prompt
instructs a genuine qualitative synthesis weighing conviction and
evidence quality, and the UI displays the deterministic vote tally
alongside the AI's (possibly different) final call so the two are never
confused.

**A minority view is preserved, not hidden:** if a persona dissented for
a substantive reason, `minorityViewWorthConsidering` surfaces it even
though it didn't carry the final recommendation.

**FACT / CALCULATION / AI OPINION / FINAL CONCLUSION:** the 8 agents'
real outputs are FACT; `VoteTally` is CALCULATION (`source: "calculated"`);
persona evaluations and debate are AI OPINION; `overallConclusion` /
`recommendationRationale` are the FINAL CONCLUSION, explicitly the
committee's judgment, never presented as settled fact.

**UI:** "What The AI Thinks" leads (the main summary, per spec), then the
rating/confidence/vote tally, reasons to be optimistic/careful, with the
full persona-by-persona votes, debate exchanges, and disagreement detail
available behind a "Show full committee detail" toggle — understandable
without expanding anything, but expandable for anyone who wants the
supporting reasoning.

Try it: `GET /api/investment-committee/AAPL` (expect this to be at least
as slow as the Forecasting Agent, since it depends on the same 8 agents
plus two more AI calls of its own).

## Forecasting Agent

The master synthesis agent — "based on everything we know, what could
happen to this stock?" — at `src/server/agents/forecasting`.

**"Do not create duplicate versions of these analyses" taken to its full
conclusion:** this agent calls the REAL `run*` functions of every other
analysis agent built in Steps 4, 6, 8, 9, 10, 11, 12, and 13 (Technical,
Fundamental, Valuation, Sentiment, Macro, Competitor, Management, Risk),
all in parallel, and uses their actual outputs as inputs. There is no
second implementation of a technical score, a DCF estimate, a sentiment
read, etc. anywhere in this agent — those numbers can only come from the
real modules.

**Honest about cost:** this is, by a wide margin, the most expensive
single action in the app — up to 8 other AI agents (two of which
internally call News Intelligence themselves) plus this agent's own
synthesis call. The UI says so plainly before the button is clicked
("can take up to a minute"), and the response shows exactly which of the
8 inputs actually contributed (`inputsUsed`), since any of them can fail
independently (e.g. an FMP plan limit) without failing the whole
forecast — "combine the available evidence," not "require every input to
succeed."

**Arithmetic is never done by the LLM — this is the core requirement of
this step, enforced structurally:** the AI provides each scenario's price
target and probability judgment; `calculations.ts` then deterministically
(a) normalizes bear+base+bull probabilities to sum to EXACTLY 100 no
matter what the AI produced, (b) computes Expected Price as the
probability-weighted average, (c) computes Expected Return, and (d)
rounds every price to avoid false precision (e.g. never "$183.47"). 18
dedicated tests cover this math, including a sweep across a dozen awkward
probability inputs that all must still sum to exactly 100.

**Valuation Engine's real DCF bear/base/bull fair values anchor the price
targets** rather than the AI inventing numbers from nothing — passed in
as `valuationDcfEstimates`, another instance of reuse over duplication.

**FACT / ASSUMPTION / CALCULATION / FORECAST / AI INTERPRETATION:** the
other agents' real outputs are FACT; explicit assumptions are labeled and
explained, never presented as fact; expected price/return and normalized
probabilities are CALCULATION; each scenario's price target is a
FORECAST (an estimate under stated assumptions, never a guarantee); the
narratives, catalysts, and confidence explanation are AI INTERPRETATION.

**UI:** current price, a visual bear/base/bull range chart, scenario
cards (with the most-likely scenario highlighted), expected price/return,
confidence score, catalysts, a risk summary (not a duplicate of the full
Risk Analyst output), and forecast assumptions — with a horizon switcher
for 3/6/12 months.

Try it: `GET /api/forecast/AAPL` (expect this one to take noticeably
longer than any other endpoint in the app).

## Risk Analyst

Actively challenges the investment case — "what could go wrong?" — at
`src/server/agents/risk-analyst`. This is the first purely synthesis
agent: it introduces no new external data source and instead reuses real
data already flowing through the app.

**A deliberate cost/architecture decision:** the spec calls for
challenging the whole investment case, but re-running every other paid AI
agent (Fundamental Analyst, Valuation Engine, Competitor Analysis,
Management Analysis) just to gather inputs would be both expensive and
largely redundant. Instead this agent reuses:
- **Free, deterministic data** from Step 1 (price/volatility, via the
  same shared `annualizedVolatility` function the Technical Analysis
  Agent uses), Step 5 (revenue/margin/debt/cash/free-cash-flow trends),
  and Step 10 (real macro indicators) — see `signals.ts`.
- **Step 7's News Intelligence output** (one AI call), filtered down to
  its already-classified bearish and high/very-high-importance events —
  the same efficient reuse pattern Sentiment Analysis (Step 9) uses.

Total cost: two AI calls (News's + this agent's own), not eight.

**Severity and probability are enforced as separate dimensions** — the
Zod schema requires both fields independently on every risk item, and a
dedicated test confirms a risk item missing either field is rejected.

**No fabricated risks:** the system prompt requires every risk to be
grounded in the real signals or real news events given; for risk
categories with no supporting data point, the AI may raise the general
consideration but must explicitly say no specific evidence is available
rather than inventing a statistic. No exact stock-price impact is ever
claimed — potential impact is framed in terms of which real business
drivers could plausibly be affected.

**FACT / CALCULATION / ASSUMPTION / AI INTERPRETATION / RISK ASSESSMENT:**
the reused real data is FACT; `RiskFactorSignals` is CALCULATION
(deterministic, `source: "calculated"`); "potential impact" framing is
built on explicit ASSUMPTION language; the reasoning behind each risk is
AI INTERPRETATION; severity/probability/riskScore are explicitly the
agent's RISK ASSESSMENT, never presented as measured fact.

**UI:** risk score and level lead, then the #1 risk prominently
highlighted, then 3-5 biggest risks (each with severity, probability,
impact, and what to watch for, shown separately), then what would make
the AI more bearish or less worried — matching the spec's required
section order, without overwhelming the user with dozens of risks.

Try it: `GET /api/risk/AAPL`.

## Management Analysis

Judges execution quality and trustworthiness of company leadership, at
`src/server/agents/management-analysis`, built on a new
`src/server/insider-trading` data domain.

**A genuinely honest limitation, handled correctly instead of glossed
over:** this app has no source of historical management guidance
statements (e.g. "we expect revenue to grow 20%") or their outcomes, and
no earnings-call transcripts. Rather than let the AI recall specific
guidance figures from its training data — which this app could never
attach a verified source or date to — `trackRecordVsGuidance` is
structurally forced to state that comparison is unavailable. This is
enforced two ways: the system prompt makes it a hard rule with "no
exceptions", and a dedicated test confirms the field's content states
unavailability rather than a specific figure.

**A genuinely new, correctly-integrated data domain:** insider trading
(SEC Form 4 filings) is company-specific and changes periodically, so it
follows the exact same provider/service/cache/Prisma pattern as
`market-data`, `fundamentals`, and `news` — real transactions via FMP's
Search Insider Trades endpoint, each retaining its real SEC filing URL,
transaction date, and filing date.

**Real capital-allocation evidence, no new data source needed:**
dividend, debt, cash, free-cash-flow, and an implied-share-count trend
(a defensible buyback signal derived from real net income ÷ EPS across
periods) are all computed deterministically from Step 5's existing
financial-statement history — see `capital-allocation.ts`.

**Insider selling is never automatically bearish:** the system prompt
explicitly forbids framing a sale as a negative signal by default,
consistent with the many legitimate reasons executives sell shares.

**FACT / CALCULATION / AI INTERPRETATION / CONCLUSION:** real insider
transactions and financial-statement figures are FACT; capital-allocation
trends and the insider-activity summary are CALCULATION
(`source: "calculated"`); the score, assessment, and explanations are AI
INTERPRETATION (`source: "ai"`); `overallConclusion` is the CONCLUSION,
never presented as settled fact.

**UI:** score and STRONG/GOOD/NEUTRAL/CONCERNING/VERY_CONCERNING lead,
then what's going well / concerns, the (honestly unavailable) guidance
track record, capital-allocation trend cells, insider activity, and a
HIGH/MEDIUM/LOW/INSUFFICIENT_DATA credibility rating — matching the
spec's required section order.

Try it: `GET /api/management/AAPL`.

## Competitor Analysis

Determines whether a company is winning or losing against its real
competitors, at `src/server/agents/competitor-analysis`.

**Integration, not duplication:** competitor identification reuses
`getPeerSymbols` (Step 8's real FMP peer lookup) rather than building a
second discovery mechanism. Every company's metrics — the primary company
and each candidate competitor — are computed by the exact same
`computeCompanyMetricSet` function over real quote (Step 1) and
financial-statement (Step 5) data, so every comparison is apples-to-apples.
Critically, this agent does **not** trigger the separate, paid-AI
Fundamental Analyst or Valuation Engine for each competitor — that would
be both expensive (multiplying AI calls by the number of peers) and
unnecessary, since this agent only needs the real underlying numbers, not
another AI's opinion of them.

**No fabricated market share:** this app has no real market-share data
source. The system prompt explicitly forbids stating a specific
market-share percentage; the AI may only say a company "appears to be
gaining/losing ground" as an inference from real relative growth rates,
always framed as an interpretation, never as a market-share statistic.

**Genuinely relevant competitors, not just same-industry:** FMP's peers
data is combined with the AI's general knowledge of what each candidate
company actually does (same pattern as the Macro Analysis agent) — a
candidate that turns out not to be a meaningful competitor can be
excluded from the comparison entirely rather than forced in.

**FACT / CALCULATION / AI INTERPRETATION / CONCLUSION:** `CompanyMetricSet`
(revenue, growth rates, margins, ROE, simple P/E, etc.) is CALCULATION —
deterministic, real, null when unavailable. Competitor selection reasons,
the comparison table's leading/average/lagging/unavailable labels, the
competitive score, and strengths/weaknesses/threat are AI INTERPRETATION.

**Score is not an average:** the system prompt explicitly instructs
weighting factors by what matters most to the company's specific
industry, not averaging every metric equally.

**UI:** "Who Is Winning?" leads, then the comparison table (Growth /
Profitability / Financial Strength / Valuation / Competitive Position),
score, strengths/weaknesses, and the single biggest competitive threat —
kept deliberately simple per the spec.

Try it: `GET /api/competitors/AAPL`.

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
checks like "lower discount rate must produce a higher fair value"), the
Sentiment Analysis agent's reuse of shared indicator functions, its
graceful degradation when supporting data is unavailable, and its AI
schema validation, the Macro Analysis agent's real-indicator provenance,
in-memory cache behavior, and company-specific relevance enforcement, and
the Competitor Analysis agent's real-data metric calculations,
competitor-relevance schema validation, and graceful degradation when
peer identification fails, the Management Analysis agent's
deterministic capital-allocation math, insider-transaction parsing and
aggregation, and — notably — a dedicated test confirming the AI cannot
fabricate a historical guidance figure, and the Risk Analyst's reuse of
shared risk signals, its filtering of news down to bearish/high-importance
events, and — notably — a dedicated test confirming severity and
probability are enforced as genuinely separate, independently-required
fields, the Forecasting Agent's deterministic calculation math
(18 tests alone, including a sweep across a dozen probability inputs that
must all still sum to exactly 100) and its graceful degradation across
up to 8 independently-failing sub-agents, and the Investment Committee's
deterministic vote tally, its two-phase persona/debate flow (including a
dedicated test confirming Phase 2 receives Phase 1's evaluations
unmodified), and its AI schema validation, and the Devil's Advocate's
bidirectional committee-review consistency check (catching a response
that claims a revision without actually providing one, or vice versa)
and its verified `precomputedGathered` cost-sharing with Forecast and
the Committee, and the Final AI Investment Report's deterministic label
bucketing (never fabricating a label for missing data), its real
cross-agent consistency checking, and — notably — a dedicated test
confirming a full report generation calls the shared 8-agent gatherer
exactly once despite depending on Forecast, the Committee, and Devil's
Advocate all at once, and Prediction Tracking's deterministic accuracy
math (36 tests alone, including the spec's own "12-month prediction not
wrong after 1 month" example) plus a dedicated test proving evaluation
updates can only ever touch the initially-null evaluation columns, never
an original prediction field, and Analysis History's immutability
guarantee (a dedicated test confirms `save-service.ts` only ever calls
`create`, never `update`) plus its graceful degradation when a
comparison's AI call fails (real saved history is still returned rather
than hidden) (577 tests total). These are
unit tests — a good next step is integration tests against a real test
database.

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
