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
 * (e.g. genuine truncation mid-object), this throws just like a plain
 * `JSON.parse` would, and the caller's existing AI_PARSE_ERROR handling
 * applies unchanged.
 */
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
    throw new Error("No JSON object found in AI response.");
  }

  const candidate = stripped.slice(firstBrace, lastBrace + 1);
  return JSON.parse(candidate); // throws if genuinely malformed -- caller handles this
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1]!.trim() : trimmed;
}
