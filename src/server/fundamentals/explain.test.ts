import { describe, expect, it } from "vitest";
import { explainMetricSeries } from "./explain";

describe("explainMetricSeries", () => {
  it("describes steady growth in everyday language, without jargon", () => {
    const result = explainMetricSeries("revenue", [100e9, 115e9, 130e9, 145e9], "annual");
    expect(result.explanation.toLowerCase()).toContain("grown");
    expect(result.explanation).not.toMatch(/CAGR|basis points/i);
  });

  it("formats currency values for display, keeping raw values precise", () => {
    const result = explainMetricSeries("revenue", [100_000_000_000, 115_000_000_000], "annual");
    expect(result.formattedValues[0]).toBe("$100.00B");
    expect(result.values[0]).toBe(100_000_000_000); // raw value untouched
  });

  it("treats debt increases as ambiguous, not automatically bad", () => {
    const result = explainMetricSeries("totalDebt", [40e9, 45e9, 60e9], "annual");
    expect(result.explanation).toContain("isn't automatically bad");
  });

  it("describes free cash flow growth as generally positive", () => {
    const result = explainMetricSeries("freeCashFlow", [15e9, 18e9, 25e9, 29e9], "annual");
    expect(result.explanation.toLowerCase()).toContain("grown");
  });

  it("describes a decline honestly", () => {
    const result = explainMetricSeries("netIncome", [50e9, 40e9, 30e9], "annual");
    expect(result.explanation.toLowerCase()).toContain("shrunk");
  });

  it("handles a flat series without claiming growth or decline", () => {
    const result = explainMetricSeries("cash", [10e9, 10e9, 10e9], "annual");
    expect(result.explanation.toLowerCase()).toContain("roughly the same");
  });

  it("handles a single data point without a trend claim", () => {
    const result = explainMetricSeries("eps", [1.5], "annual");
    expect(result.explanation).toContain("Not enough history");
  });

  it("handles no data at all without crashing", () => {
    const result = explainMetricSeries("revenue", [null, null], "annual");
    expect(result.explanation).toContain("No data available");
    expect(result.formattedValues).toEqual(["—", "—"]);
  });

  it("skips null values when finding first/last for the trend but keeps them in the raw series", () => {
    const result = explainMetricSeries("revenue", [null, 100e9, 120e9], "annual");
    expect(result.values).toEqual([null, 100e9, 120e9]);
    expect(result.explanation.toLowerCase()).toContain("grown");
  });

  it("references quarters vs years based on periodType", () => {
    const annual = explainMetricSeries("revenue", [100e9, 110e9, 120e9], "annual");
    const quarterly = explainMetricSeries("revenue", [100e9, 110e9, 120e9], "quarterly");
    expect(annual.explanation).toContain("year");
    expect(quarterly.explanation).toContain("quarter");
  });
});
