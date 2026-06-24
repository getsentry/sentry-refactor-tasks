import { join } from "node:path";

/**
 * Name of the per-repo directory that holds a repo's refactor-tasks config:
 * `repo.yaml` plus a `conventions/` folder. It lives at the root of each target
 * repo (e.g. `~/code/sentry/.sentry-refactor-tasks/`) and is never published
 * with this package.
 */
export const CONFIG_DIR_NAME = ".sentry-refactor-tasks";

export function configDir(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIR_NAME);
}

export function conventionsDir(repoRoot: string): string {
  return join(configDir(repoRoot), "conventions");
}
