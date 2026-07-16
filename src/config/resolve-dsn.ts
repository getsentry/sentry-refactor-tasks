import { z } from "zod";

/**
 * Resolve the Sentry DSN used for reporting. Prefers an explicit `--dsn` flag,
 * then falls back to the `SENTRY_DSN` environment variable. Throws when neither
 * is set, or when the value isn't a valid URL — reporting can't proceed without
 * a real DSN.
 */
export function resolveDsn(flag?: string): string {
  const dsn = flag?.trim() || process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    throw new Error("No Sentry DSN. Pass --dsn <dsn> or set SENTRY_DSN.");
  }
  return z.string().url().parse(dsn);
}
