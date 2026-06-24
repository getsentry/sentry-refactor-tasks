import { stat } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";
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
 * Resolve the repo to operate on from a starting directory. Returns the parsed
 * `repo.yaml` augmented with `path` (the repo root, which is also the scan
 * target — scanning happens in place, with no clone).
 */
export async function resolveRepo(startDir: string): Promise<ResolvedRepoConfig> {
  const path = await findRepoRoot(startDir);
  const config = await loadRepoConfig(path);
  return { ...config, path };
}
