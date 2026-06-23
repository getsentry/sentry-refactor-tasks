import { loadRepoConfig } from "../config/load-repo-config.ts";
import { ensureCheckout } from "../config/checkout.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { scanRepo } from "../scanner/pipeline.ts";
import { printFindings } from "../reporter/console.ts";
import { reportFindings } from "../reporter/sentry.ts";
import { log } from "../utils/logger.ts";

export async function scanAndReportCommand(
  repoName: string,
  options: { model?: string; patternFilter?: string },
): Promise<void> {
  const config = await ensureCheckout(await loadRepoConfig(repoName), repoName);
  const patterns = await loadAllPatterns(repoName);

  const findings = await scanRepo(patterns, config, repoName, {
    model: options.model,
    patternFilter: options.patternFilter,
  });

  printFindings(findings);

  if (findings.length > 0) {
    await reportFindings(findings, config.sentry_dsn);
  } else {
    log("No findings to report to Sentry.");
  }
}
