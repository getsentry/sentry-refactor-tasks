import { resolveRepo } from "../config/resolve-repo.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";
import { FindingReporter } from "../reporter/sentry.ts";
import { log } from "../utils/logger.ts";

export async function scanAndReportCommand(options: {
  model?: string;
  patternFilter?: string;
  cwd?: string;
}): Promise<void> {
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);

  // Stream each pattern's findings to Sentry as it completes: the reporter
  // sends a chunk as soon as enough findings accumulate, so reporting overlaps
  // with scanning instead of waiting for the whole scan to finish.
  const reporter = new FindingReporter(config.sentry_dsn, { chunkSize: config.chunk_size });

  const findings = await scanRepo(patterns, config, {
    model: options.model,
    patternFilter: options.patternFilter,
    onFindings: (found) => reporter.add(found),
  });

  if (findings.length > 0) {
    await reporter.finish();
  } else {
    log("No findings to report to Sentry.");
  }

  printFindings(findings);
}
