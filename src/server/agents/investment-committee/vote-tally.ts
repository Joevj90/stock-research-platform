import type { PersonaEvaluation, VoteTally } from "@/lib/investment-committee-types";

/**
 * Deterministic vote count -- "verify calculations programmatically"
 * applied to counting, not just arithmetic. The AI forms each persona's
 * independent recommendation, but the TALLY of how many voted
 * buy/hold/sell is pure counting, computed here, never trusted to the
 * AI's own arithmetic (the same principle the Forecasting Agent applies
 * to probability normalization).
 */
export function computeVoteTally(evaluations: PersonaEvaluation[]): VoteTally {
  let buy = 0;
  let hold = 0;
  let sell = 0;

  for (const evaluation of evaluations) {
    if (evaluation.recommendation === "buy") buy++;
    else if (evaluation.recommendation === "hold") hold++;
    else if (evaluation.recommendation === "sell") sell++;
  }

  return { source: "calculated", buy, hold, sell, totalVotes: evaluations.length };
}
