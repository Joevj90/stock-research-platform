import type { InsiderTradingProvider } from "./provider.interface";
import type { InsiderTransaction, InsiderTransactionType } from "@/lib/insider-trading-types";
import type { Result } from "@/lib/types";
import { logger } from "@/server/logger";

const log = logger.child("insider-trading:mock");

const MOCK_INSIDERS = [
  { name: "Mock Executive A", role: "officer: CEO" },
  { name: "Mock Executive B", role: "officer: CFO" },
  { name: "Mock Director C", role: "director" },
];

/**
 * MOCK insider trading provider -- NOT real transactions. Generates
 * deterministic, clearly-labeled placeholder transactions (no real SEC
 * filing URL) so the Management Analysis agent is fully exercisable
 * without a real API key.
 */
export class MockInsiderTradingProvider implements InsiderTradingProvider {
  readonly id = "mock" as const;
  readonly isMock = true;

  async getInsiderTransactions(ticker: string, limit: number): Promise<Result<InsiderTransaction[]>> {
    if (!/^[A-Za-z.]{1,10}$/.test(ticker)) {
      return {
        ok: false,
        error: { code: "INVALID_TICKER", message: `"${ticker}" is not a valid ticker symbol.` },
      };
    }

    const now = new Date();
    const count = Math.min(limit, MOCK_INSIDERS.length * 2);
    const types: InsiderTransactionType[] = ["sale", "purchase"];

    const transactions: InsiderTransaction[] = Array.from({ length: count }, (_, i) => {
      const insider = MOCK_INSIDERS[i % MOCK_INSIDERS.length]!;
      const date = new Date(now);
      date.setDate(date.getDate() - i * 20);

      return {
        ticker: ticker.toUpperCase(),
        reportingName: `${insider.name} (mock)`,
        role: insider.role,
        transactionType: types[i % types.length]!,
        transactionDate: date.toISOString(),
        filingDate: date.toISOString(),
        shares: 1000 + i * 250,
        pricePerShare: 100 + i * 2,
        url: null,
        provider: "mock",
        retrievedAt: new Date().toISOString(),
      };
    });

    log.debug("generated mock insider transactions", { ticker, count: transactions.length });
    return { ok: true, data: transactions };
  }
}
