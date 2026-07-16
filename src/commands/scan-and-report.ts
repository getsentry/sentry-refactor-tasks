import { resolveRepo } from "../config/resolve-repo.ts";
import { resolveDsn } from "../config/resolve-dsn.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";
import { reportFindings } from "../reporter/sentry.ts";
import { log } from "../utils/logger.ts";

export async function scanAndReportCommand(options: {
  model?: string;
  patternFilter?: string;
  cwd?: string;
  dsn?: string;
}): Promise<void> {
  // Resolve the DSN up front so a missing one fails before any scanning work.
  const dsn = resolveDsn(options.dsn);
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);

  const findings = await scanRepo(patterns, config, {
    model: options.model,
    patternFilter: options.patternFilter,
  });

  printFindings(findings);

  if (findings.length > 0) {
    await reportFindings(findings, dsn);
  } else {
    log("No findings to report to Sentry.");
  }
}
