import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * STRUCTURAL GUARD: the watchlist check must never make an AI call.
 *
 * This is a cost rule, and cost rules written only in comments get
 * broken by the next person who wants "just a quick summary" on the
 * check screen. The watchlist can hold 25 stocks; wiring the analysis
 * pipeline into the bulk check button would turn one ordinary click
 * into 25 multi-agent runs, each of which fans out to eight further
 * agents. That is the single most expensive accidental action the app
 * could offer, so it is blocked here by test rather than by good
 * intentions.
 *
 * The per-stock "Run full AI analysis" action is unaffected: it lives
 * on the existing stock page and is triggered one ticker at a time.
 */

const WATCHLIST_PATHS = [
  "src/server/watchlist",
  "src/app/api/watchlist",
  "src/lib/trend-reset.ts",
];

/** Imports that would pull an AI call into this path, directly or by
 * way of a module that makes one. */
const FORBIDDEN_IMPORTS = [
  "call-anthropic",
  "@/server/agents",
  "anthropic",
  "interpretForecast",
  "runForecast",
  "runFinalReport",
  "gatherAnalysisSummaries",
];

function collectFiles(target: string): string[] {
  const abs = path.resolve(process.cwd(), target);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return [];
  }
  if (stat.isFile()) return [abs];

  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    out.push(...collectFiles(path.join(target, entry)));
  }
  return out;
}

describe("the watchlist path makes no AI calls", () => {
  it("has files to check (guards against the glob silently matching nothing)", () => {
    const files = WATCHLIST_PATHS.flatMap(collectFiles).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("imports nothing that reaches Anthropic", () => {
    const files = WATCHLIST_PATHS.flatMap(collectFiles).filter(
      (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts")
    );

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Only look at import statements -- the word "anthropic" appearing
      // in a comment explaining why there is no AI call here is fine,
      // and is in fact exactly what this file wants to encourage.
      const importLines = source
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line));

      for (const line of importLines) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          if (line.toLowerCase().includes(forbidden.toLowerCase())) {
            violations.push(`${path.relative(process.cwd(), file)}: ${line.trim()}`);
          }
        }
      }
    }

    expect(violations, `AI imports found in the watchlist path:\n${violations.join("\n")}`).toEqual([]);
  });
});
