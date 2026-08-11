import { appendFileSync } from "node:fs";

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function log(message: string): void {
  console.error(message);
}

export function verbose(message: string): void {
  if (verboseEnabled) {
    console.error(`[verbose] ${message}`);
  }
}

export function error(message: string): void {
  console.error(`Error: ${message}`);
}

/**
 * Mirror a diagnostic into the GitHub Actions job summary, when running under
 * Actions (`GITHUB_STEP_SUMMARY` set). The summary is rendered on the run page
 * itself, so a failure surfaces there without anyone having to open raw step
 * logs — the channel that hid `no-deprecated-callsite`'s broken detector for
 * weeks. A no-op outside Actions. Best-effort: a write failure here must not
 * mask the diagnostic it was trying to surface.
 */
export function logToStepSummary(heading: string, body: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `### ${heading}\n\n\`\`\`\n${body}\n\`\`\`\n\n`);
  } catch (err) {
    verbose(
      `Failed to write to GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
