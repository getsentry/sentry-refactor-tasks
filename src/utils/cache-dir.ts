import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root directory for all cached data (scan results, generated prefilter commands).
 *
 * Resolves to a stable, user-level location so the cache survives across runs —
 * including `npx`, where the package itself lives in an ephemeral install dir.
 * Honors `XDG_CACHE_HOME`, falling back to `~/.cache`.
 */
export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "sentry-refactor-tasks");
}
