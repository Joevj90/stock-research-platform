/**
 * The single scoring rule for "did the AI call the direction right?",
 * shared by the accuracy statistics (server) and the per-row
 * Correct/Wrong labels and chart colours (client), so the table and the
 * summary can never disagree about the same prediction.
 *
 * Pure arithmetic, no server dependencies, which is why it lives in
 * src/lib rather than src/server: client components may import it
 * directly without pulling any server-only code into the browser bundle.
 *
 * WHY THIS REPLACED THE OLD RULE. Predictions used to be graded on three
 * outcomes -- up (over +2%), flat (within +/-2%), down (under -2%) --
 * while the "no analysis" baseline was graded on two, up or down. That
 * made the comparison unfair in one direction only. Short-horizon
 * forecasts usually predict small moves (a CAVA 1-week call of -0.9% is
 * "flat"), so if the stock then fell 4% the AI was marked WRONG despite
 * calling the direction, while the baseline has no flat option and can
 * never lose points that way. On the first 27 resolved 1-week
 * predictions this dragged the AI's measured edge far below where a fair
 * comparison would put it.
 *
 * Now both sides use the same rule: the sign of the predicted return
 * against the sign of the actual return. How well the AI's small "flat"
 * calls stayed small is still measured, separately, by
 * `isFlatCall`/`stayedFlat`, because that is a different question.
 */

/** Moves smaller than this, in percent, count as "flat" for the
 * separate flat-call measurement only. It does not affect whether a
 * direction call was right. */
export const FLAT_BAND_PCT = 2;

/** True if the AI called the direction correctly, false if not, and
 * null when there is no call to grade: a predicted return of exactly 0
 * makes no directional claim, and an actual return of exactly 0 has no
 * direction to match. Null predictions are left out of accuracy, the
 * baseline and simulated returns alike, so all three stay comparable. */
export function isCallCorrect(expectedReturnPct: number, actualReturnPct: number | null): boolean | null {
  if (actualReturnPct === null) return null;
  if (expectedReturnPct === 0 || actualReturnPct === 0) return null;
  return expectedReturnPct > 0 === actualReturnPct > 0;
}

/** The AI predicted a move small enough to be effectively "no big move". */
export function isFlatCall(expectedReturnPct: number): boolean {
  return Math.abs(expectedReturnPct) <= FLAT_BAND_PCT;
}

/** The stock really did stay within the flat band. */
export function stayedFlat(actualReturnPct: number): boolean {
  return Math.abs(actualReturnPct) <= FLAT_BAND_PCT;
}
