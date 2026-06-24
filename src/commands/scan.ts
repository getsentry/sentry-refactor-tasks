import { resolveRepo } from "../config/resolve-repo.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";

export async function scanCommand(
  patternName: string | undefined,
  options: { model?: string; dryRun?: boolean; cwd?: string },
): Promise<void> {
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);

  const findings = await scanRepo(patterns, config, {
    model: options.model,
    dryRun: options.dryRun,
    patternFilter: patternName,
  });

  printFindings(findings);

  if (!options.dryRun) {
    console.log(JSON.stringify(findings, null, 2));
  }
}
