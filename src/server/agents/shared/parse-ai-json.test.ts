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

  it("throws an AiJsonParseError carrying a snippet centered on the failure position for a mid-string syntax error", () => {
    // An unescaped quote inside a string value -- a real-world failure mode.
    const input = '{"a": "text with an "unescaped" quote inside", "b": 2}';
    try {
      parseAiJsonResponse(input);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiJsonParseError);
      const parseErr = err as AiJsonParseError;
      expect(parseErr.rawTextLength).toBe(input.length);
    }
  });

  it("throws when no JSON object is present at all", () => {
    expect(() => parseAiJsonResponse("I cannot complete this request.")).toThrow();
  });
});
