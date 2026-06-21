import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Pattern } from "../config/schemas.ts";
import type { RepoConfig } from "../config/schemas.ts";
import { execShell } from "../utils/exec.ts";
import { findFiles } from "../utils/glob.ts";
import { verbose } from "../utils/logger.ts";

function cacheDir(): string {
  return join(import.meta.dirname, "..", "..", "cache");
}

function cachedCommandPath(repoName: string, patternName: string): string {
  return join(cacheDir(), repoName, `${patternName}.sh`);
}

async function isCacheValid(
  repoName: string,
  patternName: string,
  yamlPath: string,
): Promise<boolean> {
  const cachePath = cachedCommandPath(repoName, patternName);
  try {
    const [cacheStat, yamlStat] = await Promise.all([stat(cachePath), stat(yamlPath)]);
    return cacheStat.mtimeMs > yamlStat.mtimeMs;
  } catch {
    return false;
  }
}

async function runPrefilterCommand(command: string, repoPath: string): Promise<string[]> {
  const expanded = command.replace(/\{repo_path\}/g, repoPath);
  verbose(`Running prefilter: ${expanded}`);
  try {
    const { stdout } = await execShell(expanded, {
      timeout: 30_000,
      cwd: repoPath,
    });
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

export async function getFilesToScan(
  pattern: Pattern,
  config: RepoConfig,
  repoName: string,
  _yamlPath?: string,
): Promise<string[]> {
  if (pattern.prefilter) {
    verbose(`Using inline prefilter for "${pattern.name}"`);
    return runPrefilterCommand(pattern.prefilter, config.path);
  }

  if (_yamlPath) {
    const cacheValid = await isCacheValid(repoName, pattern.name, _yamlPath);
    if (cacheValid) {
      const { readFile } = await import("node:fs/promises");
      const cachePath = cachedCommandPath(repoName, pattern.name);
      const command = (await readFile(cachePath, "utf-8")).trim();
      verbose(`Using cached prefilter for "${pattern.name}"`);
      return runPrefilterCommand(command, config.path);
    }
  }

  verbose(`Using glob fallback for "${pattern.name}" in ${config.path}`);
  return findFiles(config.path, pattern.include, pattern.exclude);
}
