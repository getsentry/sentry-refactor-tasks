import * as Sentry from "@sentry/node";
import type { ScanFinding } from "../scanner/result.ts";
import { log, verbose } from "../utils/logger.ts";

export function initSentry(dsn: string): void {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    tracesSampleRate: 0,
  });
}

function githubUrl(finding: ScanFinding): string {
  return `https://github.com/${finding.repo}/blob/${finding.git_sha}/${finding.file}#L${finding.line_start}-L${finding.line_end}`;
}

function buildMessage(finding: ScanFinding): string {
  const lines = [
    `## [${finding.pattern_name}] ${finding.file}:${finding.line_start}`,
    "",
    `Detected at commit \`${finding.git_sha.slice(0, 8)}\``,
    "",
    "### Code",
    "```",
    finding.snippet,
    "```",
    "",
    "### Problem",
    finding.explanation,
    "",
    "### Why this matters",
    finding.why.trim(),
    "",
    "### How to fix",
    finding.fix.trim(),
  ];
  return lines.join("\n");
}

export function reportFinding(finding: ScanFinding): void {
  Sentry.withScope((scope) => {
    scope.setFingerprint([finding.pattern_name, finding.file, String(finding.line_start)]);

    scope.setTag("violation_type", finding.pattern_name);
    scope.setTag("severity", finding.severity);
    scope.setTag("confidence", finding.confidence);
    scope.setTag("repo", finding.repo);
    scope.setTag("git_sha", finding.git_sha);
    scope.setTag("url", githubUrl(finding));
    for (const tag of finding.tags) {
      scope.setTag(`convention.${tag}`, "true");
    }

    scope.setLevel(finding.severity === "error" ? "error" : "warning");

    scope.setContext("violation", {
      file: finding.file,
      line_start: finding.line_start,
      line_end: finding.line_end,
      snippet: finding.snippet,
      why: finding.why,
      fix: finding.fix,
      explanation: finding.explanation,
    });

    Sentry.captureMessage(buildMessage(finding));
  });

  verbose(`Reported: [${finding.pattern_name}] ${finding.file}:${finding.line_start}`);
}

export async function reportFindings(findings: ScanFinding[], dsn: string): Promise<void> {
  initSentry(dsn);

  for (const finding of findings) {
    reportFinding(finding);
  }

  log(`Reported ${findings.length} findings to Sentry`);
  await Sentry.flush(10_000);
}
