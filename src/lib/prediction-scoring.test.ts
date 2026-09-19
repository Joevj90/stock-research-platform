import { describe, expect, it } from "vitest";
import { isCallCorrect, isFlatCall, stayedFlat } from "./prediction-scoring";

describe("isCallCorrect", () => {
  it("grades by direction only, however small the predicted move", () => {
    expect(isCallCorrect(-0.9, -4)).toBe(true);
    expect(isCallCorrect(0.3, 12)).toBe(true);
    expect(isCallCorrect(-0.9, 4)).toBe(false);
  });

  it("returns null when there is no direction to grade", () => {
    expect(isCallCorrect(0, 5)).toBeNull();
    expect(isCallCorrect(3, 0)).toBeNull();
    expect(isCallCorrect(3, null)).toBeNull();
  });
});

describe("flat calls", () => {
  it("treats predicted moves within 2% as flat calls", () => {
    expect(isFlatCall(-1.9)).toBe(true);
    expect(isFlatCall(2.1)).toBe(false);
  });

  it("checks whether the actual move stayed within 2%", () => {
    expect(stayedFlat(1.5)).toBe(true);
    expect(stayedFlat(-4)).toBe(false);
  });
});
