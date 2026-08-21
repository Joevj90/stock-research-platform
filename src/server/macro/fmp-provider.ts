import type { MacroDataProvider } from "./provider.interface";
import type { MacroIndicator } from "@/lib/macro-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("macro:fmp");

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const FETCH_TIMEOUT_MS = 15_000;

/** The specific real indicators this app pulls, and how to label them.
 * A curated subset (interest rates via Treasury yield, inflation, growth,
 * employment) rather than every indicator FMP offers -- chosen because
 * these four map directly onto the macro factors named in the spec
 * (interest rates, inflation, GDP/growth, employment) and are reliably
 * available. Commodity prices, dollar strength, credit conditions, etc.
 * are not fetched here; the AI is instructed to say so rather than
 * invent them (see the agent's interpreter.ts). */
const INDICATOR_CONFIG: { name: string; label: string; unit: string }[] = [
  { name: "GDP", label: "GDP Growth", unit: "%" },
  { name: "CPI", label: "Inflation (CPI)", unit: "%" },
  { name: "unemploymentRate", label: "Unemployment Rate", unit: "%" },
];

/**
 * Financial Modeling Prep macro data provider -- the real, non-mock
 * source. Uses FMP's Economic Indicators endpoint
 * (GET /stable/economic-indicators?name=X) for GDP/CPI/unemployment, and
 * the Treasury Rates endpoint (GET /stable/treasury-rates) for the
 * 10-year yield as an interest-rate proxy.
 */
export class FmpMacroDataProvider implements MacroDataProvider {
  readonly id = "fmp" as const;
  readonly isMock = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "FmpMacroDataProvider requires FMP_API_KEY to be set. Get a free key at " +
          "https://site.financialmodelingprep.com/ and set it in your .env file."
      );
    }
  }

  async getIndicators(): Promise<Result<MacroIndicator[]>> {
    const results = await Promise.all([
      ...INDICATOR_CONFIG.map((cfg) => this.fetchIndicator(cfg)),
      this.fetchTreasuryYield(),
    ]);

    const failures = results.filter((r): r is { ok: false; error: { code: string; message: string } } => !r.ok);
    if (failures.length === results.length) {
      // Every indicator failed the same way -- surface the first error
      // rather than a vague "no data" (most commonly this is a plan or
      // auth issue affecting the whole economics dataset).
      return failures[0]!;
    }

    const indicators = results.filter((r): r is { ok: true; data: MacroIndicator } => r.ok).map((r) => r.data);
    return { ok: true, data: indicators };
  }

  private async fetchIndicator(cfg: { name: string; label: string; unit: string }): Promise<Result<MacroIndicator>> {
    const result = await this.fetchJson<FmpEconomicIndicatorRow[]>("/economic-indicators", { name: cfg.name });
    if (!result.ok) return result;

    const latest = result.data[0]; // FMP returns most-recent-first
    if (!latest) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: `No data returned for indicator "${cfg.name}".` } };
    }

    return {
      ok: true,
      data: {
        name: cfg.name,
        label: cfg.label,
        value: latest.value,
        unit: cfg.unit,
        asOfDate: new Date(latest.date).toISOString(),
        source: "Financial Modeling Prep (Economic Indicators)",
        url: "https://site.financialmodelingprep.com/developer/docs/stable/economics-indicators",
        retrievedAt: new Date().toISOString(),
      },
    };
  }

  private async fetchTreasuryYield(): Promise<Result<MacroIndicator>> {
    const result = await this.fetchJson<FmpTreasuryRateRow[]>("/treasury-rates", {});
    if (!result.ok) return result;

    const latest = result.data[0];
    if (!latest || latest.year10 === undefined) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "No 10-year Treasury yield data returned." } };
    }

    return {
      ok: true,
      data: {
        name: "treasury10Year",
        label: "10-Year Treasury Yield",
        value: latest.year10,
        unit: "%",
        asOfDate: new Date(latest.date).toISOString(),
        source: "Financial Modeling Prep (Treasury Rates)",
        url: "https://site.financialmodelingprep.com/developer/docs/stable/treasury-rates",
        retrievedAt: new Date().toISOString(),
      },
    };
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
              "Economic data requires a paid FMP plan (the free Basic plan only covers prices and quotes). " +
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

interface FmpEconomicIndicatorRow {
  date: string;
  value: number;
}

interface FmpTreasuryRateRow {
  date: string;
  year10?: number;
}
