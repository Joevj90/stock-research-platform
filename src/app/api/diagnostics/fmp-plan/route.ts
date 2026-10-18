import { NextResponse } from "next/server";
import { env } from "@/server/config/env";
import { logger } from "@/server/logger";

/**
 * PHASE 0 DIAGNOSTIC -- answers one question before any backtest code is
 * written: how much daily price history does THIS API key actually
 * return, and can the survivorship-bias problem be fixed on this plan?
 *
 * This exists because the documentation is not trustworthy on this
 * point, in both directions. FMP's pricing page lists intraday charts as
 * a Premium feature, yet this app's Starter key returns intraday data.
 * The same page says Starter is capped at "5 years of historical data",
 * while the FAQ says something different in kind -- that requests for
 * more than five years "require a loop over 5-year intervals using the
 * from and to parameters", which describes a per-QUERY window, not a
 * per-PLAN lookback limit.
 *
 * Those two readings lead to completely different projects:
 *   - per-query window  -> 10+ years is reachable by chunking, and the
 *     backtest can cover more than one market regime.
 *   - per-plan lookback -> roughly 2021 onward is all that exists, which
 *     is mostly a single bull market, and a trend-following strategy
 *     tested only there will look good whether or not it works.
 *
 * Probe 2 below is the one that decides it. Everything is read-only and
 * makes no Anthropic calls.
 */

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const log = logger.child("diagnostics:fmp-plan");
const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 20_000;

interface ProbeResult {
  name: string;
  question: string;
  path: string;
  params: Record<string, string>;
  httpStatus: number | null;
  ok: boolean;
  rowCount: number | null;
  earliestDate: string | null;
  latestDate: string | null;
  approxYearsReturned: number | null;
  error: string | null;
  /** Plain-English reading of this probe, written out so the result is
   * interpretable without knowing the endpoint semantics. */
  verdict: string;
}

interface DatedRow {
  date?: string;
  dateAdded?: string;
  symbol?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Pulls the date field out of whichever shape the endpoint returns.
 * Price rows use `date`; constituent-change rows use `dateAdded`. */
function rowDate(row: DatedRow): string | null {
  return row.date ?? row.dateAdded ?? null;
}

async function probe(args: {
  name: string;
  question: string;
  path: string;
  params: Record<string, string>;
  interpret: (r: Omit<ProbeResult, "verdict">) => string;
}): Promise<ProbeResult> {
  const { name, question, path, params, interpret } = args;

  const url = new URL(`${FMP_BASE_URL}${path}`);
  url.searchParams.set("apikey", env.FMP_API_KEY ?? "");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const base: Omit<ProbeResult, "verdict"> = {
    name,
    question,
    path,
    params,
    httpStatus: null,
    ok: false,
    rowCount: null,
    earliestDate: null,
    latestDate: null,
    approxYearsReturned: null,
    error: null,
  };

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    base.httpStatus = res.status;

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      base.error = `Response was not JSON: ${text.slice(0, 200)}`;
      return { ...base, verdict: interpret(base) };
    }

    if (!res.ok) {
      // 402 is the one that matters: it is FMP's "your plan does not
      // include this" status, as opposed to 403 for a bad key.
      const message = typeof parsed === "object" && parsed !== null && "Error Message" in parsed
        ? String((parsed as Record<string, unknown>)["Error Message"])
        : text.slice(0, 200);
      base.error = message;
      return { ...base, verdict: interpret(base) };
    }

    const rows = Array.isArray(parsed) ? (parsed as DatedRow[]) : [];
    base.rowCount = rows.length;

    const dates = rows.map(rowDate).filter((d): d is string => typeof d === "string" && d.length > 0).sort();

    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    if (earliest !== undefined && latest !== undefined) {
      base.earliestDate = earliest;
      base.latestDate = latest;
      const spanMs = new Date(latest).getTime() - new Date(earliest).getTime();
      base.approxYearsReturned = Math.round((spanMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
    }

    base.ok = rows.length > 0;
    return { ...base, verdict: interpret(base) };
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    return { ...base, verdict: interpret(base) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  if (!env.FMP_API_KEY) {
    return NextResponse.json(
      { error: "FMP_API_KEY is not set in this environment, so there is nothing to test." },
      { status: 400 }
    );
  }

  const today = toDateStr(new Date());

  // Probes run one after another rather than in parallel. The point is
  // to read each result cleanly, and a burst of parallel calls would
  // confuse a plan-limit failure with a rate-limit failure.
  const probes: ProbeResult[] = [];

  probes.push(
    await probe({
      name: "max_lookback_single_query",
      question: "Asking for 35 years in one request, how far back does the data actually start?",
      path: "/historical-price-eod/full",
      params: { symbol: "AAPL", from: "1990-01-01", to: today },
      interpret: (r) => {
        if (!r.ok) return `FAILED (HTTP ${r.httpStatus}): ${r.error ?? "no rows"}`;
        return `Returned ${r.rowCount} bars starting ${r.earliestDate} (about ${r.approxYearsReturned} years). If this is close to 5 years, a single request is capped -- see the next probe for whether chunking gets past it.`;
      },
    })
  );

  probes.push(
    await probe({
      name: "old_window_2012_2016",
      question:
        "THE DECISIVE ONE. Asking for a 5-year window that ended a decade ago. If this returns data, the 5-year limit is per-request and 10+ years is reachable by looping. If it returns nothing, the plan genuinely cannot see past about 5 years ago.",
      path: "/historical-price-eod/full",
      params: { symbol: "AAPL", from: "2012-01-01", to: "2016-12-31" },
      interpret: (r) => {
        if (!r.ok) {
          return `NO DATA (HTTP ${r.httpStatus}): ${r.error ?? "empty response"}. Reading: the plan is capped at a rolling ~5-year lookback, so a 10-year backtest is NOT possible on this key.`;
        }
        return `GOT ${r.rowCount} bars from ${r.earliestDate} to ${r.latestDate}. Reading: the 5-year figure is a per-request window, not a lookback cap -- 10+ years IS reachable by requesting several windows and stitching them together.`;
      },
    })
  );

  probes.push(
    await probe({
      name: "single_old_year_2014",
      question: "A narrower control: one calendar year, ten years ago. Confirms the result above was not a window-size artefact.",
      path: "/historical-price-eod/full",
      params: { symbol: "AAPL", from: "2014-01-01", to: "2014-12-31" },
      interpret: (r) =>
        r.ok
          ? `GOT ${r.rowCount} bars (${r.earliestDate} to ${r.latestDate}). A 2014 request works.`
          : `NO DATA (HTTP ${r.httpStatus}): ${r.error ?? "empty response"}. 2014 is out of reach.`,
    })
  );

  probes.push(
    await probe({
      name: "historical_sp500_constituents",
      question:
        "Can the survivorship-bias problem be fixed? This endpoint lists which companies joined and left the index and when. Without it, a backtest can only use today's 500 names, which flatters past results.",
      path: "/historical-sp500-constituent",
      params: {},
      interpret: (r) => {
        if (r.httpStatus === 402) return "PLAN-BLOCKED (HTTP 402). Survivorship bias can be estimated but not removed.";
        if (!r.ok) return `UNAVAILABLE (HTTP ${r.httpStatus}): ${r.error ?? "empty response"}. Survivorship bias cannot be removed, only flagged.`;
        return `AVAILABLE: ${r.rowCount} index changes, earliest dated ${r.earliestDate}. Survivorship bias CAN be corrected.`;
      },
    })
  );

  probes.push(
    await probe({
      name: "current_sp500_constituents",
      question: "Does the current S&P 500 list work, and how many names does it return?",
      path: "/sp500-constituent",
      params: {},
      interpret: (r) =>
        r.ok
          ? `AVAILABLE: ${r.rowCount} companies.`
          : `UNAVAILABLE (HTTP ${r.httpStatus}): ${r.error ?? "empty response"}.`,
    })
  );

  // A deliberately modest burst. Enough to show whether short bursts are
  // tolerated, nowhere near enough to get the key throttled -- a real
  // rate-limit test would be a bad trade against a production key.
  const burstStart = Date.now();
  const burstSymbols = ["AAPL", "MSFT", "NVDA", "JPM", "KO", "XOM", "JNJ", "PG", "V", "HD"];
  const burstResults = await Promise.all(
    burstSymbols.map(async (symbol) => {
      const url = new URL(`${FMP_BASE_URL}/quote`);
      url.searchParams.set("apikey", env.FMP_API_KEY ?? "");
      url.searchParams.set("symbol", symbol);
      try {
        const res = await fetch(url.toString());
        return res.status;
      } catch {
        return null;
      }
    })
  );
  const burstMs = Date.now() - burstStart;
  // Count ANY non-200 as a failure. An earlier version counted only
  // HTTP 429 and so reported "no throttling" on a run where two of ten
  // requests came back 402 -- a 20% failure rate presented as a clean
  // pass. Whatever status a refused request carries, it is a request
  // that did not return data.
  const failures = burstSymbols
    .map((symbol, i) => ({ symbol, status: burstResults[i] }))
    .filter((r) => r.status !== 200);

  const summary = {
    checkedAt: new Date().toISOString(),
    howToRead:
      "Look at old_window_2012_2016 first. It decides whether a 10-year backtest is possible on this plan. Then historical_sp500_constituents, which decides whether the backtest can be made honest about companies that dropped out of the index.",
    probes,
    concurrencyCheck: {
      question: "Do 10 simultaneous requests get throttled?",
      symbolsRequested: burstSymbols.length,
      elapsedMs: burstMs,
      statuses: burstResults,
      failureCount: failures.length,
      failures,
      verdict:
        failures.length > 0
          ? `${failures.length} of ${burstSymbols.length} FAILED under concurrency: ${failures
              .map((f) => `${f.symbol} (HTTP ${f.status})`)
              .join(", ")}. If the same symbols fail on a re-run it is symbol-specific; if different ones fail it is a concurrency limit, and bulk reads need lower concurrency plus a retry.`
          : `All ${burstSymbols.length} concurrent requests succeeded (${burstMs}ms total).`,
    },
  };

  log.info("FMP plan diagnostic complete", {
    decisiveProbeOk: probes.find((p) => p.name === "old_window_2012_2016")?.ok,
    constituentsOk: probes.find((p) => p.name === "historical_sp500_constituents")?.ok,
  });

  return NextResponse.json(summary, { status: 200 });
}
