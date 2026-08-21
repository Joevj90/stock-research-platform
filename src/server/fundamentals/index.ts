/**
 * Public entry point for the fundamentals module. Mirrors
 * src/server/market-data/index.ts: deliberately does NOT re-export the
 * provider singleton or any concrete provider class, so
 * UI → Backend → Fundamentals Service → Provider stays an enforced shape.
 */
export { getFundamentals } from "./service";
export type { FundamentalsProvider } from "./provider.interface";
