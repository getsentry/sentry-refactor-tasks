import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../config/resolve-repo.ts";
import { conventionsDir } from "../config/paths.ts";
import { loadRepoConfig } from "../config/load-repo-config.ts";
import { loadPattern } from "../config/load-pattern.ts";
import { log, error } from "../utils/logger.ts";

export async function validateCommand(options: { cwd?: string }): Promise<void> {
  const root = await findRepoRoot(options.cwd ?? process.cwd());
  let errorCount = 0;

  log(`Validating ${root}...`);

  try {
    const config = await loadRepoConfig(root);
    log(`  repo.yaml: OK (${config.repo})`);
  } catch (e) {
    error(`  repo.yaml: ${e instanceof Error ? e.message : String(e)}`);
    errorCount++;
  }

  const dir = conventionsDir(root);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    error(`  conventions/: directory not found`);
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    try {
      await loadPattern(join(dir, file));
      log(`  ${file}: OK`);
    } catch (e) {
      error(`  ${file}: ${e instanceof Error ? e.message : String(e)}`);
      errorCount++;
    }
  }

  if (errorCount > 0) {
    error(`\n${errorCount} validation error(s) found`);
    process.exitCode = 1;
  } else {
    log("\nAll configs valid.");
  }
}
