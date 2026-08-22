import { describe, expect, it } from "vitest";
import { bucketScoreNeg100To100, bucketRiskScore0To100, bucketGrowthPct, bucketMarginPct } from "./labels";

describe("bucketScoreNeg100To100", () => {
  it("buckets scores across all five labels correctly", () => {
    expect(bucketScoreNeg100To100(75)).toBe("strong");
    expect(bucketScoreNeg100To100(30)).toBe("good");
    expect(bucketScoreNeg100To100(0)).toBe("average");
    expect(bucketScoreNeg100To100(-30)).toBe("weak");
    expect(bucketScoreNeg100To100(-75)).toBe("very_weak");
  });

  it("handles exact boundary values consistently", () => {
    expect(bucketScoreNeg100To100(50)).toBe("strong");
    expect(bucketScoreNeg100To100(49)).toBe("good");
    expect(bucketScoreNeg100To100(20)).toBe("good");
    expect(bucketScoreNeg100To100(19)).toBe("average");
  });

  it("returns unavailable for null, never a guessed label", () => {
    expect(bucketScoreNeg100To100(null)).toBe("unavailable");
  });
});

describe("bucketRiskScore0To100", () => {
  it("is inverted -- low risk score means a strong (good) label", () => {
    expect(bucketRiskScore0To100(10)).toBe("strong");
    expect(bucketRiskScore0To100(90)).toBe("very_weak");
  });

  it("buckets across the full range", () => {
    expect(bucketRiskScore0To100(30)).toBe("good");
    expect(bucketRiskScore0To100(50)).toBe("average");
    expect(bucketRiskScore0To100(70)).toBe("weak");
  });

  it("returns unavailable for null", () => {
    expect(bucketRiskScore0To100(null)).toBe("unavailable");
  });
});

describe("bucketGrowthPct", () => {
  it("buckets growth percentages sensibly", () => {
    expect(bucketGrowthPct(25)).toBe("strong");
    expect(bucketGrowthPct(10)).toBe("good");
    expect(bucketGrowthPct(2)).toBe("average");
    expect(bucketGrowthPct(-5)).toBe("weak");
    expect(bucketGrowthPct(-20)).toBe("very_weak");
  });

  it("returns unavailable for null", () => {
    expect(bucketGrowthPct(null)).toBe("unavailable");
  });
});

describe("bucketMarginPct", () => {
  it("buckets margin percentages sensibly", () => {
    expect(bucketMarginPct(25)).toBe("strong");
    expect(bucketMarginPct(12)).toBe("good");
    expect(bucketMarginPct(7)).toBe("average");
    expect(bucketMarginPct(2)).toBe("weak");
    expect(bucketMarginPct(-5)).toBe("very_weak");
  });

  it("returns unavailable for null", () => {
    expect(bucketMarginPct(null)).toBe("unavailable");
  });
});
