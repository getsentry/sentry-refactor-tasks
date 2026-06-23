import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "../utils/exec.ts";
import { log, verbose } from "../utils/logger.ts";
import type { CheckedOutRepoConfig, RepoConfig } from "./schemas.ts";

// Cloning / fetching a large repo can take a while, so give git ops plenty of room.
const GIT_TIMEOUT = 600_000;

export function checkoutsDir(): string {
  return join(import.meta.dirname, "..", "..", "checkouts");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a local checkout of the repo's `git_url` exists, advanced to the most
 * recent revision of its default branch, and return the config augmented with
 * the checkout `path`.
 *
 * The checkout lives at `checkouts/<repoName>` and is reused across runs: an
 * existing clone is fetched and hard-reset to the latest remote tip, while a
 * fresh one is shallow-cloned.
 */
export async function ensureCheckout(
  config: RepoConfig,
  repoName: string,
): Promise<CheckedOutRepoConfig> {
  const dir = join(checkoutsDir(), repoName);

  if (await pathExists(join(dir, ".git"))) {
    log(`Updating checkout of ${config.repo} → ${dir}`);
    await exec("git", ["-C", dir, "fetch", "--depth", "1", "origin"], { timeout: GIT_TIMEOUT });
    await exec("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], { timeout: GIT_TIMEOUT });
    await exec("git", ["-C", dir, "clean", "-fdq"], { timeout: GIT_TIMEOUT });
  } else {
    log(`Cloning ${config.git_url} → ${dir}`);
    await mkdir(checkoutsDir(), { recursive: true });
    await exec("git", ["clone", "--depth", "1", config.git_url, dir], { timeout: GIT_TIMEOUT });
  }

  const { stdout } = await exec("git", ["-C", dir, "rev-parse", "HEAD"]);
  verbose(`Checked out ${config.repo} @ ${stdout.trim().slice(0, 8)}`);

  return { ...config, path: dir };
}
