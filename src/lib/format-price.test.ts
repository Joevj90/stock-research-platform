import { describe, expect, it } from "vitest";
import { formatPrice } from "./format-price";

describe("formatPrice", () => {
  it("always shows two decimals below $1000", () => {
    expect(formatPrice(51.5)).toBe("$51.50");
    expect(formatPrice(51)).toBe("$51.00");
    expect(formatPrice(2.83)).toBe("$2.83");
  });

  it("shows whole dollars with separators from $1000", () => {
    expect(formatPrice(2400)).toBe("$2,400");
  });

  it("returns a dash for non-finite input rather than printing NaN", () => {
    expect(formatPrice(Number.NaN)).toBe("—");
  });
});
