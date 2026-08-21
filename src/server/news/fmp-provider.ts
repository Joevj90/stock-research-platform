import type { NewsProvider } from "./provider.interface";
import type { NewsArticle } from "@/lib/news-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("news:fmp");

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Financial Modeling Prep news provider -- the real, non-mock source.
 * Uses FMP's Search Stock News endpoint
 * (GET /stable/news/stock?symbols=TICKER), confirmed against FMP's own
 * documentation (see the chat writeup) rather than assumed from the
 * legacy /api/v3/ surface, which is retired for new accounts.
 *
 * Like the other FMP providers in this app, this class only fetches and
 * normalizes -- no grouping, no classification, no DB writes. Grouping
 * duplicate coverage and judging importance is the News Intelligence
 * agent's job (src/server/agents/news-intelligence), not this provider's.
 */
export class FmpNewsProvider implements NewsProvider {
  readonly id = "fmp" as const;
  readonly isMock = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "FmpNewsProvider requires FMP_API_KEY to be set. Get a free key at " +
          "https://site.financialmodelingprep.com/ and set it in your .env file."
      );
    }
  }

  async getCompanyNews(ticker: string, limit: number): Promise<Result<NewsArticle[]>> {
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
      };
    }

    const result = await this.fetchJson<FmpNewsRow[]>("/news/stock", {
      symbols: ticker,
      limit: String(limit),
    });
    if (!result.ok) return result;

    const now = new Date().toISOString();
    const articles: NewsArticle[] = result.data
      .filter((row) => Boolean(row.url) && Boolean(row.title) && Boolean(row.publishedDate))
      .map((row) => ({
        headline: row.title,
        url: row.url,
        source: row.site ?? row.publisher ?? "Unknown source",
        publishedAt: new Date(row.publishedDate).toISOString(),
        summary: row.text ?? null,
        sourceType: null, // FMP's stock-news endpoint doesn't classify source type
        ticker: ticker.toUpperCase(),
        retrievedAt: now,
        provider: "fmp",
      }));

    return { ok: true, data: articles };
  }

  private async fetchJson<T>(path: string, params: Record<string, string>): Promise<Result<T>> {
    const url = new URL(`${FMP_BASE_URL}${path}`);
    url.searchParams.set("apikey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });

      if (res.status === 401 || res.status === 403) {
        log.error("FMP authentication failed", { status: res.status, path });
        return {
          ok: false,
          error: { code: "PROVIDER_AUTH_ERROR", message: "Market data provider rejected the API key." },
        };
      }
      if (res.status === 402) {
        log.warn("FMP plan does not include this endpoint", { status: res.status, path });
        return {
          ok: false,
          error: {
            code: "PROVIDER_PLAN_REQUIRED",
            message:
              "News data requires a paid FMP plan (the free Basic plan only covers prices and quotes). " +
              "Upgrade at financialmodelingprep.com/pricing-plans to use this feature.",
          },
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          error: { code: "PROVIDER_RATE_LIMITED", message: "Market data provider rate limit exceeded." },
        };
      }
      if (!res.ok) {
        log.error("FMP request failed", { status: res.status, path });
        return {
          ok: false,
          error: { code: "PROVIDER_ERROR", message: `Market data provider returned ${res.status}.` },
        };
      }

      const json = (await res.json()) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_ERROR",
            message: String((json as { "Error Message": unknown })["Error Message"]),
          },
        };
      }

      return { ok: true, data: (Array.isArray(json) ? json : []) as T };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      log.error("FMP request threw", { path, error: err instanceof Error ? err.message : String(err) });
      return {
        ok: false,
        error: {
          code: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
          message: isAbort ? "Market data provider timed out." : "Could not reach the market data provider.",
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface FmpNewsRow {
  symbol?: string;
  publishedDate: string;
  title: string;
  url: string;
  site?: string;
  publisher?: string;
  text?: string;
  image?: string;
}
