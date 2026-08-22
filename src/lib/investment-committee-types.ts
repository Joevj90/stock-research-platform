import type { AnalysisInputsAvailability } from "@/server/agents/shared/analysis-summaries";

/**
 * Investment Committee domain types.
 *
 * FACT / CALCULATION / AI INTERPRETATION / CONCLUSION, mapped:
 *   - FACT           = the real outputs of the 8 analysis modules this
 *                       committee reviews (via the same shared gatherer
 *                       Forecasting Agent uses) -- never re-derived here.
 *   - CALCULATION    = VoteTally below -- a deterministic count of the 5
 *                       personas' BUY/HOLD/SELL recommendations, computed
 *                       in code, never trusted to the AI's own counting.
 *   - AI INTERPRETATION = each persona's independent evaluation, the
 *                       debate exchanges, and the final synthesized
 *                       recommendation -- tagged `source: "ai"`.
 *   - CONCLUSION     = `overallConclusion` / `recommendationRationale` --
 *                       explicitly the committee's judgment, never
 *                       presented as certain fact.
 */

export type AnalystPersona =
  | "value_investor"
  | "growth_investor"
  | "momentum_trader"
  | "risk_averse_investor"
  | "contrarian_investor";

export type CommitteeRecommendation = "buy" | "hold" | "sell";

export interface PersonaEvaluation {
  persona: AnalystPersona;
  recommendation: CommitteeRecommendation;
  confidence: number; // 0..100
  keyReasons: string[];
  concernsOrCaveats: string[];
  whatTheyWeighMost: string; // plain-language description of this persona's lens
}

/** Deterministic tally of the 5 personas' recommendations -- pure
 * counting, computed in code from PersonaEvaluation[], never asked of
 * the LLM. */
export interface VoteTally {
  source: "calculated";
  buy: number;
  hold: number;
  sell: number;
  totalVotes: number;
}

export interface DebateExchange {
  personaA: AnalystPersona;
  personaB: AnalystPersona;
  challenge: string; // what personaA pushes back on
  response: string; // how personaB responds
}

export interface Disagreement {
  topic: string;
  description: string;
  sidesSummary: string; // plain language: who leans which way and why
}

export interface CommitteeInterpretation {
  source: "ai";
  model: string;
  generatedAt: string;

  personaEvaluations: PersonaEvaluation[]; // exactly 5, independently formed
  voteTally: VoteTally;

  keyAgreements: string[];
  keyDisagreements: Disagreement[];
  debateExchanges: DebateExchange[];

  finalRecommendation: CommitteeRecommendation;
  finalConfidence: number; // 0..100
  recommendationRationale: string;
  /** A dissenting view worth keeping in mind even though it didn't carry
   * the final recommendation -- committees that only report consensus
   * hide useful information. Null only if there is genuinely no notable
   * minority view. */
  minorityViewWorthConsidering: string | null;

  overallConclusion: string;
}

export interface CommitteeResult {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  inputsUsed: AnalysisInputsAvailability;
  interpretation: CommitteeInterpretation;
}
