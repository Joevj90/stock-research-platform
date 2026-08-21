import type { InsiderTradingProvider } from "./provider.interface";
import type { InsiderTransaction, InsiderTransactionType } from "@/lib/insider-trading-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("insider-trading:fmp");

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Financial Modeling Prep insider trading provider -- the real, non-mock
 * source. Uses FMP's Search Insider Trades endpoint
 * (GET /stable/insider-trading/search?symbol=X), which returns real SEC
 * Form 4 disclosures with a link to the official filing -- confirmed
 * against FMP's own documentation (see the chat writeup).
 */
export class FmpInsiderTradingProvider implements InsiderTradingProvider {
  readonly id = "fmp" as const;
  readonly isMock = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "FmpInsiderTradingProvider requires FMP_API_KEY to be set. Get a free key at " +
          "https://site.financialmodelingprep.com/ and set it in your .env file."
      );
    }
  }

  async getInsiderTransactions(ticker: string, limit: number): Promise<Result<InsiderTransaction[]>> {
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
      };
    }

    const result = await this.fetchJson<FmpInsiderTradeRow[]>("/insider-trading/search", {
      symbol: ticker,
      limit: String(limit),
    });
    if (!result.ok) return result;

    const now = new Date().toISOString();
    const transactions: InsiderTransaction[] = result.data
      .filter((row) => Boolean(row.transactionDate) && Boolean(row.filingDate))
      .map((row) => ({
        ticker: ticker.toUpperCase(),
        reportingName: row.reportingName ?? "Unknown",
        role: row.typeOfOwner ?? null,
        transactionType: normalizeTransactionType(row.transactionType, row.acquistionOrDisposition),
        transactionDate: new Date(row.transactionDate).toISOString(),
        filingDate: new Date(row.filingDate).toISOString(),
        shares: row.securitiesTransacted ?? 0,
        pricePerShare: row.price && row.price > 0 ? row.price : null,
        url: row.link ?? null,
        provider: "fmp",
        retrievedAt: now,
      }));

    return { ok: true, data: transactions };
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
        return { ok: false, error: { code: "PROVIDER_AUTH_ERROR", message: "Market data provider rejected the API key." } };
      }
      if (res.status === 402) {
        log.warn("FMP plan does not include this endpoint", { status: res.status, path });
        return {
          ok: false,
          error: {
            code: "PROVIDER_PLAN_REQUIRED",
            message:
              "Insider trading data requires a paid FMP plan (the free Basic plan only covers prices and quotes). " +
              "Upgrade at financialmodelingprep.com/pricing-plans to use this feature.",
          },
        };
      }
      if (res.status === 429) {
        return { ok: false, error: { code: "PROVIDER_RATE_LIMITED", message: "Market data provider rate limit exceeded." } };
      }
      if (!res.ok) {
        log.error("FMP request failed", { status: res.status, path });
        return { ok: false, error: { code: "PROVIDER_ERROR", message: `Market data provider returned ${res.status}.` } };
      }

      const json = (await res.json()) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
        return {
          ok: false,
          error: { code: "PROVIDER_ERROR", message: String((json as { "Error Message": unknown })["Error Message"]) },
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

/** FMP's raw transactionType codes (e.g. "S-Sale", "P-Purchase",
 * "A-Award", "M-Exempt") are normalized to a simple three-way
 * classification; anything not clearly a purchase or sale is "other"
 * rather than guessed. */
function normalizeTransactionType(
  rawType: string | undefined,
  acquisitionOrDisposition: string | undefined
): InsiderTransactionType {
  const raw = (rawType ?? "").toUpperCase();
  if (raw.startsWith("P-") || acquisitionOrDisposition === "A") return "purchase";
  if (raw.startsWith("S-") || acquisitionOrDisposition === "D") return "sale";
  return "other";
}

interface FmpInsiderTradeRow {
  reportingName?: string;
  typeOfOwner?: string;
  transactionType?: string;
  acquistionOrDisposition?: string;
  transactionDate: string;
  filingDate: string;
  securitiesTransacted?: number;
  price?: number;
  link?: string;
}
