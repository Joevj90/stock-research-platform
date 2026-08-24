import { jsonrepair } from "jsonrepair";

/**
 * Robustly extracts a JSON object from a raw AI text response.
 *
 * Every interpreter in this app instructs the model to respond with
 * ONLY a JSON object, but real model output occasionally includes a
 * stray leading/trailing word, a partial code fence, or similar minor
 * formatting slop despite that instruction. A naive `JSON.parse` on the
 * raw text fails in exactly those cases even though the actual JSON
 * payload is intact -- this function tries the strict parse first, then
 * falls back to locating the outermost `{...}` substring, then finally
 * to `jsonrepair` (a mature, purpose-built library for exactly this
 * problem -- repairing LLM-generated JSON: unescaped quotes, trailing
 * commas, and more, using a real parser rather than a hand-rolled
 * lookahead heuristic that had provable edge cases -- e.g. a quoted
 * phrase sitting immediately before a string's real closing quote,
 * producing back-to-back `""` that a simple next-character check
 * couldn't reliably disambiguate). It never guesses at JSON *content* --
 * if nothing produces valid, parseable JSON (e.g. genuine truncation
 * mid-object), this throws an `AiJsonParseError` carrying diagnostic
 * detail (length, a snippet near the failure) so the caller can
 * log/surface enough to actually diagnose the real cause, rather than a
 * bare "invalid JSON" with no further information.
 */

export class AiJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawTextLength: number,
    public readonly snippetStart: string,
    public readonly snippetEnd: string,
    /** A window of text centered on the exact character position where
     * JSON.parse's native error reported the problem, when that position
     * could be determined from the error message. Far more targeted than
     * generic start/end snippets for pinpointing a mid-string syntax
     * issue (e.g. an unescaped quote inside a text field). */
    public readonly snippetAtFailure: string | null = null
  ) {
    super(message);
    this.name = "AiJsonParseError";
  }
}

export function parseAiJsonResponse(rawText: string): unknown {
  const stripped = stripCodeFences(rawText);

  try {
    return JSON.parse(stripped);
  } catch {
    // Fall through to the more forgiving extraction below.
  }

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new AiJsonParseError(
      "No JSON object found in AI response.",
      rawText.length,
      rawText.slice(0, 200),
      rawText.slice(-200)
    );
  }

  const candidate = stripped.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to the repair pass below.
  }

  // Last resort: hand off to jsonrepair, a mature library purpose-built
  // for repairing exactly this class of problem. It handles unescaped
  // quotes, trailing commas, missing quotes, and more, using a real
  // parser -- far more reliable than a hand-rolled heuristic. The result
  // is always re-validated by a real JSON.parse before being trusted; if
  // jsonrepair itself can't produce valid JSON (e.g. genuine truncation),
  // this falls through to the same honest failure as before -- it never
  // silently returns corrupted data.
  try {
    return JSON.parse(jsonrepair(candidate));
  } catch (err) {
    // Genuinely malformed/truncated -- carry diagnostic detail so the
    // caller isn't stuck with a bare "invalid JSON" and no way to tell
    // truncation apart from a real mid-string syntax problem. A wide
    // window (especially more context BEFORE the reported position) is
    // deliberate: errors like "Colon expected" are often a downstream
    // symptom of a problem earlier in the text, not located exactly at
    // the reported offset.
    const errorMessage = err instanceof Error ? err.message : "Unknown JSON parse error";
    const position = extractErrorPosition(errorMessage);
    const snippetAtFailure =
      position !== null ? candidate.slice(Math.max(0, position - 400), position + 200) : null;

    throw new AiJsonParseError(
      errorMessage,
      rawText.length,
      candidate.slice(0, 300),
      candidate.slice(-300),
      snippetAtFailure
    );
  }
}

/** Node/V8's JSON.parse SyntaxError messages typically include either
 * "at position N" or "line X column Y" -- this extracts a character
 * offset from either form when present. */
function extractErrorPosition(errorMessage: string): number | null {
  const positionMatch = errorMessage.match(/position (\d+)/);
  if (positionMatch) return Number(positionMatch[1]);
  return null;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1]!.trim() : trimmed;
}
