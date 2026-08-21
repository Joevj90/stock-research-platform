// Ensures src/server/config/env.ts's Zod validation passes when test files
// import server modules (loggers, services, etc.) that read `env` at
// import time. Tests never actually touch a real database or provider —
// this just satisfies the schema so imports don't throw.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.MARKET_DATA_PROVIDER ??= "mock";
