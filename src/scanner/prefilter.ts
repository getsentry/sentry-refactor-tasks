import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedRepoConfig, Pattern } from "../config/schemas.ts";
import { cacheDir } from "../utils/cache-dir.ts";
import { execShell } from "../utils/exec.ts";
import { findFiles } from "../utils/glob.ts";
import { verbose } from "../utils/logger.ts";
import { prepareCommand, describeCommand } from "./command-template.ts";

function cachedCommandPath(slug: string, patternName: string): string {
  return join(cacheDir(), slug, `${patternName}.sh`);
}

async function isCacheValid(slug: string, patternName: string, yamlPath: string): Promise<boolean> {
  const cachePath = cachedCommandPath(slug, patternName);
  try {
    const [cacheStat, yamlStat] = await Promise.all([stat(cachePath), stat(yamlPath)]);
    return cacheStat.mtimeMs > yamlStat.mtimeMs;
  } catch {
    return false;
  }
}

async function runPrefilterCommand(template: string, repoPath: string): Promise<string[]> {
  const prepared = prepareCommand(template, repoPath);
  verbose(`Running prefilter: ${describeCommand(prepared)}`);
  try {
    const { stdout } = await execShell(prepared.command, {
      timeout: 30_000,
      cwd: repoPath,
      env: prepared.env,
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
  config: ResolvedRepoConfig,
  slug: string,
  _yamlPath?: string,
): Promise<string[]> {
  if (pattern.prefilter) {
    verbose(`Using inline prefilter for "${pattern.name}"`);
    return runPrefilterCommand(pattern.prefilter, config.path);
  }

  if (_yamlPath) {
    const cacheValid = await isCacheValid(slug, pattern.name, _yamlPath);
    if (cacheValid) {
      const { readFile } = await import("node:fs/promises");
      const cachePath = cachedCommandPath(slug, pattern.name);
      const command = (await readFile(cachePath, "utf-8")).trim();
      verbose(`Using cached prefilter for "${pattern.name}"`);
      return runPrefilterCommand(command, config.path);
    }
  }

  verbose(`Using glob fallback for "${pattern.name}" in ${config.path}`);
  return findFiles(config.path, pattern.include, pattern.exclude);
}
