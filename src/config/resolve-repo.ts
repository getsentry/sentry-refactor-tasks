import { stat } from "node:fs/promises";
import { basename, dirname, join, parse as parsePath } from "node:path";
import { exec } from "../utils/exec.ts";
import { verbose } from "../utils/logger.ts";
import { CONFIG_DIR_NAME } from "./paths.ts";
import { loadRepoConfig } from "./load-repo-config.ts";
import type { ResolvedRepoConfig } from "./schemas.ts";

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk up from `startDir` to find the root of the repo being scanned — the
 * first ancestor directory that contains a `CONFIG_DIR_NAME` folder.
 */
export async function findRepoRoot(startDir: string): Promise<string> {
  let dir = startDir;
  const { root } = parsePath(dir);

  while (true) {
    if (await isDir(join(dir, CONFIG_DIR_NAME))) return dir;
    if (dir === root) break;
    dir = dirname(dir);
  }

  throw new Error(
    `No ${CONFIG_DIR_NAME}/ directory found in ${startDir} or any parent.\n` +
      `Run this from inside a repo that has a ${CONFIG_DIR_NAME}/ folder ` +
      `(with repo.yaml and conventions/), or pass --cwd <repo>.`,
  );
}

/**
 * Extract the GitHub "owner/name" slug from a git remote URL, e.g.
 * `git@github.com:getsentry/sentry.git` or
 * `https://github.com/getsentry/sentry` → `getsentry/sentry`.
 */
export function parseRepoSlug(remoteUrl: string): string | null {
  const match = remoteUrl.trim().match(/[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

/**
 * Determine the repo's "owner/name" from its git origin remote. Falls back to
 * the directory name when there's no usable remote (permalinks won't resolve,
 * but scanning still works).
 */
async function resolveRepoName(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["-C", repoRoot, "remote", "get-url", "origin"]);
    const slug = parseRepoSlug(stdout);
    if (slug) return slug;
    verbose(`Could not parse owner/name from origin remote: ${stdout.trim()}`);
  } catch {
    verbose(`No git origin remote in ${repoRoot}; falling back to directory name`);
  }
  return basename(repoRoot);
}

/**
 * Resolve the repo to operate on from a starting directory. Returns the parsed
 * `repo.yaml` augmented with `path` (the repo root, which is also the scan
 * target — scanning happens in place, with no clone) and `repo` (the
 * owner/name slug derived from the checkout's git origin remote).
 */
export async function resolveRepo(startDir: string): Promise<ResolvedRepoConfig> {
  const path = await findRepoRoot(startDir);
  const config = await loadRepoConfig(path);
  const repo = await resolveRepoName(path);
  return { ...config, path, repo };
}
