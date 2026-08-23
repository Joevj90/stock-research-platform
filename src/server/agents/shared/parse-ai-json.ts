/**
 * Robustly extracts a JSON object from a raw AI text response.
 *
 * Every interpreter in this app instructs the model to respond with
 * ONLY a JSON object, but real model output occasionally includes a
 * stray leading/trailing word, a partial code fence, or similar minor
 * formatting slop despite that instruction. A naive `JSON.parse` on the
 * raw text fails in exactly those cases even though the actual JSON
 * payload is intact -- this function tries the strict parse first, and
 * only if that fails, falls back to locating the outermost `{...}`
 * substring and parsing that. It never repairs or guesses at malformed
 * JSON *content* -- if the extracted substring still isn't valid JSON
 * (e.g. genuine truncation mid-object), this throws an `AiJsonParseError`
 * carrying diagnostic detail (length, a snippet near the failure) so the
 * caller can log/surface enough to actually diagnose the real cause,
 * rather than a bare "invalid JSON" with no further information.
 */

export class AiJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawTextLength: number,
    public readonly snippetStart: string,
    public readonly snippetEnd: string
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
  } catch (err) {
    // Genuinely malformed/truncated -- carry diagnostic detail so the
    // caller isn't stuck with a bare "invalid JSON" and no way to tell
    // truncation apart from a real syntax problem.
    throw new AiJsonParseError(
      `${err instanceof Error ? err.message : "Unknown JSON parse error"}`,
      rawText.length,
      candidate.slice(0, 200),
      candidate.slice(-200)
    );
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1]!.trim() : trimmed;
}
