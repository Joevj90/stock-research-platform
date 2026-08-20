import { env } from "@/server/config/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type LogFields = Record<string, unknown>;

/**
 * Minimal structured logger. Every entry is a single JSON line with a
 * timestamp, level, scope, message, and optional fields — easy to pipe into
 * any log aggregator later without changing call sites.
 *
 * Usage: `logger.child("market-data").info("fetched price bars", { ticker })`
 */
class Logger {
  constructor(private readonly scope: string) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`);
  }

  debug(message: string, fields?: LogFields) {
    this.write("debug", message, fields);
  }
  info(message: string, fields?: LogFields) {
    this.write("info", message, fields);
  }
  warn(message: string, fields?: LogFields) {
    this.write("warn", message, fields);
  }
  error(message: string, fields?: LogFields) {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) return;

    const entry = {
      time: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...fields,
    };

    const line = JSON.stringify(entry);
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

export const logger = new Logger("app");
