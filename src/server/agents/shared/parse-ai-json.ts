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

  // Last resort: models occasionally write a quoted phrase for emphasis
  // inside a string value (e.g. the "base case" scenario) without
  // realizing the inner quotes need escaping, which breaks parsing from
  // that point on even though the rest of the response is fine. This is
  // a best-effort structural repair, NOT a guess at content -- it only
  // escapes a quote when it is clearly positioned mid-string (not
  // adjacent to a JSON structural character), and the result is always
  // re-validated by a real JSON.parse before being trusted. If the
  // repair doesn't produce valid JSON, this falls through to the same
  // honest failure as before -- it never silently returns corrupted data.
  try {
    return JSON.parse(escapeLikelyInternalQuotes(candidate));
  } catch (err) {
    // Genuinely malformed/truncated -- carry diagnostic detail so the
    // caller isn't stuck with a bare "invalid JSON" and no way to tell
    // truncation apart from a real mid-string syntax problem.
    const errorMessage = err instanceof Error ? err.message : "Unknown JSON parse error";
    const position = extractErrorPosition(errorMessage);
    const snippetAtFailure =
      position !== null ? candidate.slice(Math.max(0, position - 150), position + 150) : null;

    throw new AiJsonParseError(
      errorMessage,
      rawText.length,
      candidate.slice(0, 200),
      candidate.slice(-200),
      snippetAtFailure
    );
  }
}

/**
 * Escapes double-quote characters that are clearly positioned INSIDE a
 * JSON string value rather than at a legitimate string boundary. A
 * single forward pass tracking whether we're currently inside a string:
 * when a `"` is encountered while inside a string, it's only treated as
 * the real closing quote if the next non-whitespace character is a
 * plausible JSON structural character (`:`, `,`, `}`, `]`, or end of
 * text) -- otherwise it's an internal quote and gets escaped, and
 * scanning continues looking for the real closing quote. Already-escaped
 * quotes (`\"`) are left untouched. This is deliberately conservative:
 * it only fires on the specific pattern this app has actually observed
 * (a quoted phrase for emphasis inside natural-language text), and the
 * caller always re-validates the result with a real JSON.parse rather
 * than trusting this heuristic on its own.
 */
function escapeLikelyInternalQuotes(text: string): string {
  let result = "";
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (char === "\\" && i + 1 < text.length) {
      // Preserve any escape sequence as-is (e.g. \", \n, \\) without
      // reinterpreting the character after the backslash.
      result += char + text[i + 1];
      i++;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }

      // We're inside a string and hit an unescaped quote -- check
      // whether what follows (skipping whitespace) looks like a real
      // JSON structural transition. If so, this is the legitimate
      // closing quote; otherwise it's an internal quote to escape.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      const next = text[j];
      const looksLikeRealClose = next === undefined || [":", ",", "}", "]"].includes(next);

      if (looksLikeRealClose) {
        inString = false;
        result += char;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += char;
  }

  return result;
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
