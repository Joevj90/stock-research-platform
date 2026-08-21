import { z } from "zod";

/**
 * Central, validated environment configuration.
 *
 * Every env var the app depends on is declared here with a Zod schema.
 * Import `env` anywhere server-side code needs configuration instead of
 * reading `process.env` directly — that keeps the app fast-failing at
 * startup with a clear error instead of surfacing `undefined` deep in a
 * request handler.
 *
 * Phase 1: no real market-data API key is required (the mock provider is
 * used). The keys below are declared now so switching providers later is a
 * config change, not a code change.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Market data provider selection + credentials. MOCK requires no key.
  // "fmp" (Financial Modeling Prep) is the implemented real provider — see
  // src/server/market-data/fmp-provider.ts for why it was chosen.
  MARKET_DATA_PROVIDER: z.enum(["mock", "fmp", "alpha_vantage", "finnhub"]).default("mock"),
  FMP_API_KEY: z.string().optional(),

  // Fundamentals (income statement / balance sheet / cash flow) provider
  // selection. Separate from MARKET_DATA_PROVIDER on purpose — they're
  // different data domains that happen to both be servable by FMP today,
  // but keeping the switches independent means either can move to a
  // different vendor later without touching the other.
  FUNDAMENTALS_DATA_PROVIDER: z.enum(["mock", "fmp"]).default("mock"),

  // News provider selection, reuses FMP_API_KEY (same as market data and
  // fundamentals). Separate switch on purpose — see market-data/provider.ts
  // and fundamentals/provider.ts for why these are kept independent.
  NEWS_DATA_PROVIDER: z.enum(["mock", "fmp"]).default("mock"),

  // Macro/economic indicator provider selection, reuses FMP_API_KEY.
  MACRO_DATA_PROVIDER: z.enum(["mock", "fmp"]).default("mock"),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),

  // Reserved for later phases (news, filings). Optional today.
  NEWS_API_KEY: z.string().optional(),
  SEC_EDGAR_USER_AGENT: z.string().optional(),
  // Powers the AI interpretation layer of the Technical Analysis Agent
  // (src/server/agents/technical-analysis) and future AI agents.
  ANTHROPIC_API_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Optional site-wide password gate (see src/middleware.ts). Unset = app
  // stays fully open. This mirrors what middleware.ts reads from
  // process.env directly for the Edge runtime; declared here too so the
  // login API route (which runs in the Node runtime) gets the same
  // validated value.
  SITE_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
