import { describe, expect, it } from "vitest";
import { parseAiJsonResponse, AiJsonParseError } from "./parse-ai-json";

describe("parseAiJsonResponse", () => {
  it("parses clean, unwrapped JSON directly", () => {
    const result = parseAiJsonResponse('{"a": 1, "b": "x"}');
    expect(result).toEqual({ a: 1, b: "x" });
  });

  it("strips a markdown code fence wrapping the whole response", () => {
    const result = parseAiJsonResponse('```json\n{"a": 1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it("strips a code fence without the json language tag", () => {
    const result = parseAiJsonResponse('```\n{"a": 1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it("recovers when there is stray text before the JSON despite instructions not to include any", () => {
    const result = parseAiJsonResponse('Here is the analysis:\n{"a": 1, "b": [1, 2, 3]}');
    expect(result).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("recovers when there is stray text after the JSON", () => {
    const result = parseAiJsonResponse('{"a": 1}\nLet me know if you need anything else.');
    expect(result).toEqual({ a: 1 });
  });

  it("recovers when there is stray text both before and after the JSON", () => {
    const result = parseAiJsonResponse('Sure, here you go:\n{"a": 1}\nHope that helps!');
    expect(result).toEqual({ a: 1 });
  });

  it("handles nested objects and arrays correctly when extracting the outer boundary", () => {
    const input = '{"a": {"nested": [1, 2, {"deep": true}]}, "b": "text with a } brace in it"}';
    const result = parseAiJsonResponse(input);
    expect(result).toEqual({ a: { nested: [1, 2, { deep: true }] }, b: "text with a } brace in it" });
  });

  it("still throws for genuinely malformed/truncated JSON, rather than silently returning something wrong", () => {
    expect(() => parseAiJsonResponse('{"a": 1, "b": [1, 2, ')).toThrow();
  });

  it("repairs a simple mid-string unescaped quote rather than needing to fail", () => {
    // An unescaped quote inside a string value -- exactly the real-world failure mode
    // this repair pass exists for. Confirms it recovers rather than throwing.
    const input = '{"a": "text with an "unescaped" quote inside", "b": 2}';
    const result = parseAiJsonResponse(input);
    expect(result).toEqual({ a: 'text with an "unescaped" quote inside', b: 2 });
  });

  it("throws when no JSON object is present at all", () => {
    expect(() => parseAiJsonResponse("I cannot complete this request.")).toThrow();
  });

  it("throws an AiJsonParseError with diagnostic detail for a genuinely unrepairable (truncated) response", () => {
    const input = '{"a": 1, "b": [1, 2, ';
    try {
      parseAiJsonResponse(input);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiJsonParseError);
      const parseErr = err as AiJsonParseError;
      expect(parseErr.rawTextLength).toBe(input.length);
    }
  });

  describe("repairs an unescaped internal quote (the real failure mode this app diagnosed)", () => {
    it("repairs a quoted phrase used for emphasis inside a string value", () => {
      // The exact pattern diagnosed in production: a term wrapped in quotes for emphasis.
      const input = '{"explanation": "This assumes the "base case" scenario holds true.", "score": 5}';
      const result = parseAiJsonResponse(input);
      expect(result).toEqual({ explanation: 'This assumes the "base case" scenario holds true.', score: 5 });
    });

    it("repairs an internal quote inside a string that is itself inside an array", () => {
      const input = '{"reasons": ["Because of the "brand strength" factor", "A second reason"]}';
      const result = parseAiJsonResponse(input);
      expect(result).toEqual({ reasons: ['Because of the "brand strength" factor', "A second reason"] });
    });

    it("repairs multiple separate internal-quote occurrences across different fields", () => {
      const input = '{"a": "the "first" term", "b": "the "second" term"}';
      const result = parseAiJsonResponse(input);
      expect(result).toEqual({ a: 'the "first" term', b: 'the "second" term' });
    });

    it("does not corrupt already-valid JSON containing commas and colons inside string content", () => {
      const input = '{"explanation": "Growth is strong, but risks remain: margins could compress.", "score": 5}';
      const result = parseAiJsonResponse(input);
      expect(result).toEqual({ explanation: "Growth is strong, but risks remain: margins could compress.", score: 5 });
    });

    it("does not corrupt already-valid JSON with properly escaped quotes", () => {
      const input = '{"explanation": "This is a \\"properly escaped\\" quote."}';
      const result = parseAiJsonResponse(input);
      expect(result).toEqual({ explanation: 'This is a "properly escaped" quote.' });
    });

    it("still throws honestly (never silently returns wrong data) when the JSON is genuinely truncated, not just quote-broken", () => {
      const input = '{"explanation": "This assumes the "base case" scenario holds true';
      expect(() => parseAiJsonResponse(input)).toThrow();
    });
  });
});
