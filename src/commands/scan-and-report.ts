import { resolveRepo } from "../config/resolve-repo.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";
import { reportFindings } from "../reporter/sentry.ts";
import { log } from "../utils/logger.ts";

export async function scanAndReportCommand(options: {
  model?: string;
  patternFilter?: string;
  cwd?: string;
}): Promise<void> {
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);

  const findings = await scanRepo(patterns, config, {
    model: options.model,
    patternFilter: options.patternFilter,
  });

  printFindings(findings);

  if (findings.length > 0) {
    await reportFindings(findings, config.sentry_dsn, { chunkSize: config.chunk_size });
  } else {
    log("No findings to report to Sentry.");
  }
}
