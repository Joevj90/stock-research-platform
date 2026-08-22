import { describe, expect, it } from "vitest";
import { computeVoteTally } from "./vote-tally";
import type { PersonaEvaluation } from "@/lib/investment-committee-types";

function evaluation(persona: PersonaEvaluation["persona"], recommendation: PersonaEvaluation["recommendation"]): PersonaEvaluation {
  return {
    persona,
    recommendation,
    confidence: 70,
    keyReasons: [],
    concernsOrCaveats: [],
    whatTheyWeighMost: "x",
  };
}

describe("computeVoteTally", () => {
  it("counts votes correctly across a mixed set of recommendations", () => {
    const result = computeVoteTally([
      evaluation("value_investor", "buy"),
      evaluation("growth_investor", "buy"),
      evaluation("momentum_trader", "hold"),
      evaluation("risk_averse_investor", "sell"),
      evaluation("contrarian_investor", "buy"),
    ]);
    expect(result).toEqual({ source: "calculated", buy: 3, hold: 1, sell: 1, totalVotes: 5 });
  });

  it("handles a unanimous vote", () => {
    const result = computeVoteTally([
      evaluation("value_investor", "sell"),
      evaluation("growth_investor", "sell"),
      evaluation("momentum_trader", "sell"),
    ]);
    expect(result).toEqual({ source: "calculated", buy: 0, hold: 0, sell: 3, totalVotes: 3 });
  });

  it("handles an empty evaluation list without crashing", () => {
    const result = computeVoteTally([]);
    expect(result).toEqual({ source: "calculated", buy: 0, hold: 0, sell: 0, totalVotes: 0 });
  });

  it("always has buy + hold + sell equal totalVotes", () => {
    const evaluations = [
      evaluation("value_investor", "hold"),
      evaluation("growth_investor", "buy"),
      evaluation("momentum_trader", "buy"),
      evaluation("risk_averse_investor", "hold"),
      evaluation("contrarian_investor", "sell"),
    ];
    const result = computeVoteTally(evaluations);
    expect(result.buy + result.hold + result.sell).toBe(result.totalVotes);
  });
});
