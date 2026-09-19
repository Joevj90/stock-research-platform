/**
 * Formats a price for display with a consistent number of decimals.
 *
 * Without this, a JavaScript number prints with however many decimals it
 * happens to have: $51.5 next to $51.64 next to $51 on the same card,
 * which reads as three different levels of precision when it is one.
 * Two decimals below $1000 matches how share prices are quoted; above
 * that, cents add noise and whole dollars are clearer.
 */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${price.toFixed(2)}`;
}
