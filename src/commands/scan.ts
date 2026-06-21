import { loadRepoConfig } from "../config/load-repo-config.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";

export async function scanCommand(
  repoName: string,
  patternName: string | undefined,
  options: { model?: string; dryRun?: boolean },
): Promise<void> {
  const config = await loadRepoConfig(repoName);
  const patterns = await loadAllPatterns(repoName);

  const findings = await scanRepo(patterns, config, repoName, {
    model: options.model,
    dryRun: options.dryRun,
    patternFilter: patternName,
  });

  printFindings(findings);

  if (!options.dryRun) {
    console.log(JSON.stringify(findings, null, 2));
  }
}
