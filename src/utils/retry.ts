import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./logger.ts";

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base delay before a retry; attempt N waits `delayMs * N`. */
  delayMs?: number;
  /** Named in the retry log line so a transient blip is traceable to its call site. */
  label: string;
}

/**
 * Retry a flaky async operation (network timeouts, transient API errors) a
 * bounded number of times before giving up. A retry that recovers still logs
 * the attempt that failed, so a transient blip leaves a trace in the CI log
 * instead of looking like it never happened. The final failure is rethrown
 * as-is once attempts are exhausted, so a genuine, persistent problem still
 * fails loud.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      const message = err instanceof Error ? err.message : String(err);
      log(`  ${options.label} failed (attempt ${attempt}/${attempts}): ${message}; retrying...`);
      await sleep(delayMs * attempt);
    }
  }

  throw lastErr;
}
