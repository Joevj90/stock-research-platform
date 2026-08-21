/**
 * Public entry point for the news module. Mirrors market-data/index.ts
 * and fundamentals/index.ts: deliberately does NOT re-export the provider
 * singleton, so UI → Backend → News Service → Provider stays enforced.
 */
export { getCompanyNews } from "./service";
export type { NewsProvider } from "./provider.interface";
