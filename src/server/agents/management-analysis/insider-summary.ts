import type { InsiderTransaction } from "@/lib/insider-trading-types";
import type { InsiderActivitySummary } from "@/lib/management-types";

/**
 * Deterministic aggregation of real insider transactions. No AI, no
 * fabrication -- purely counting and summing real, already-fetched data.
 */
export function summarizeInsiderActivity(transactions: InsiderTransaction[]): InsiderActivitySummary {
  const purchases = transactions.filter((t) => t.transactionType === "purchase");
  const sales = transactions.filter((t) => t.transactionType === "sale");

  const sharesPurchased = purchases.reduce((sum, t) => sum + t.shares, 0);
  const sharesSold = sales.reduce((sum, t) => sum + t.shares, 0);

  const mostRecentDate = transactions.reduce<string | null>((latest, t) => {
    if (latest === null) return t.transactionDate;
    return new Date(t.transactionDate) > new Date(latest) ? t.transactionDate : latest;
  }, null);

  return {
    source: "calculated",
    transactionCount: transactions.length,
    purchaseCount: purchases.length,
    saleCount: sales.length,
    netSharesPurchased: sharesPurchased - sharesSold,
    mostRecentTransactionDate: mostRecentDate,
  };
}
