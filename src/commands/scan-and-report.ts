import { resolveRepo } from "../config/resolve-repo.ts";
import { resolveDsn } from "../config/resolve-dsn.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";
import { FindingReporter } from "../reporter/sentry.ts";
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

  // Stream each pattern's findings to Sentry as it completes: the reporter
  // sends a chunk as soon as enough findings accumulate, so reporting overlaps
  // with scanning instead of waiting for the whole scan to finish.
  const reporter = new FindingReporter(dsn, { chunkSize: config.chunk_size });

  const { findings, failures } = await scanRepo(patterns, config, {
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

  // Report every finding scanning did produce before failing: a broken
  // detector for one pattern must not cost the findings every other pattern
  // found, but the run still needs to fail loud so CI doesn't report success.
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} convention(s) failed to scan: ${failures.map((f) => f.pattern).join(", ")}. See the detect command diagnostics above.`,
    );
  }
}
