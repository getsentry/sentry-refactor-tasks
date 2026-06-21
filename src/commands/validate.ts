import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { reposDir, loadRepoConfig } from "../config/load-repo-config.ts";
import { loadPattern } from "../config/load-pattern.ts";
import { log, error } from "../utils/logger.ts";

export async function validateCommand(repoName?: string): Promise<void> {
  const repos = repoName
    ? [repoName]
    : (await readdir(reposDir())).filter((r) => !r.startsWith("."));

  let errorCount = 0;

  for (const repo of repos) {
    log(`Validating ${repo}...`);

    try {
      await loadRepoConfig(repo);
      log(`  repo.yaml: OK`);
    } catch (e) {
      error(`  repo.yaml: ${e instanceof Error ? e.message : String(e)}`);
      errorCount++;
    }

    const conventionsDir = join(reposDir(), repo, "conventions");
    let files: string[];
    try {
      files = (await readdir(conventionsDir)).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
      );
    } catch {
      error(`  conventions/: directory not found`);
      errorCount++;
      continue;
    }

    for (const file of files) {
      try {
        await loadPattern(join(conventionsDir, file));
        log(`  ${file}: OK`);
      } catch (e) {
        error(`  ${file}: ${e instanceof Error ? e.message : String(e)}`);
        errorCount++;
      }
    }
  }

  if (errorCount > 0) {
    error(`\n${errorCount} validation error(s) found`);
    process.exitCode = 1;
  } else {
    log("\nAll configs valid.");
  }
}
