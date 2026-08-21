/**
 * Public entry point for the market-data module. This is the ONLY file
 * other layers of the app should import from — deliberately, this barrel
 * does NOT re-export the provider singleton or any concrete provider
 * class. See service.ts's boundary comment for why: it's what makes
 * "UI → Backend → Market Data Service → Provider" an enforced shape rather
 * than just a diagram.
 */
export { getQuote, getHistoricalPrices, getStockSnapshot, getPeerSymbols } from "./service";
export type { MarketDataProvider } from "./provider.interface";
