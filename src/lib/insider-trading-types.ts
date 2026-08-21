/**
 * Insider trading domain types -- the FACT layer for the Management
 * Analysis agent's insider-activity section. Every field here is exactly
 * what a provider returned; never AI-modified.
 */

export type InsiderTransactionType = "purchase" | "sale" | "other";

export interface InsiderTransaction {
  ticker: string;
  reportingName: string;
  role: string | null;
  transactionType: InsiderTransactionType;
  transactionDate: string; // ISO date
  filingDate: string; // ISO date
  shares: number;
  pricePerShare: number | null;
  url: string | null; // real SEC filing link, when available
  provider: string;
  retrievedAt: string; // ISO datetime
}
