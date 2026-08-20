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
  MARKET_DATA_PROVIDER: z.enum(["mock", "alpha_vantage", "finnhub"]).default("mock"),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),

  // Reserved for later phases (news, filings, AI analysis). Optional today.
  NEWS_API_KEY: z.string().optional(),
  SEC_EDGAR_USER_AGENT: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
