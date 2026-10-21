/**
 * Shared setup for the offline backtest scripts: .env.local loading and
 * where data and results live.
 *
 * Price data is stored OUTSIDE the project folder by default, because the
 * project sits in OneDrive and syncing ~10,000 small files would be slow
 * and pointless. Override with BACKTEST_DATA_DIR in .env.local.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]!]) continue;
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

export function dataDir(): string {
  const dir = process.env.BACKTEST_DATA_DIR || path.join(os.homedir(), "stock-backtest-data");
  fs.mkdirSync(path.join(dir, "bars"), { recursive: true });
  return dir;
}

export function resultsDir(): string {
  const dir = path.join(process.cwd(), "backtest-results");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function requireAlpacaKeys(): { keyId: string; secret: string } {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) {
    console.error("Missing ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY in .env.local.");
    process.exit(1);
  }
  return { keyId, secret };
}

export const pct = (x: number, digits = 1) =>
  Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%` : "n/a";
