import { setTimeout as sleep } from "node:timers/promises";
import * as Sentry from "@sentry/node";
import type { ScanFinding } from "../scanner/result.ts";
import { log, verbose } from "../utils/logger.ts";

/**
 * Sentry rate-limits (and spike-protects) bursts of ingest. Firing every
 * finding in a tight loop and flushing once can trip those limits: the
 * transport honors the 429 `X-Sentry-Rate-Limits` headers and silently drops
 * the remainder, so most findings never become issues.
 *
 * The `chunkSize` control tunes this: `0` (the default) sends everything in a
 * single batch — fine when the project has spike protection disabled — while a
 * positive value sends paced chunks of that size, flushing after each, to stay
 * under the per-project rate limit. The pacing/flush knobs below are further
 * tunable via env vars for projects with different limits.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envIntOptional(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const CHUNK_DELAY_MS = envInt("REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS", 1000);
const FLUSH_TIMEOUT_MS = envInt("REFACTOR_TASKS_SENTRY_FLUSH_TIMEOUT_MS", 30_000);

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

export interface ReportOptions {
  /**
   * Findings per Sentry batch. `0` (the default) sends every finding in a single
   * batch — only safe when the project has spike protection disabled, otherwise
   * Sentry rate-limits the burst and silently drops most events. A positive
   * value sends throttled chunks of that size instead. Falls back to the
   * `REFACTOR_TASKS_SENTRY_CHUNK_SIZE` env var, then `0`.
   */
  chunkSize?: number;
}

function resolveChunkSize(explicit?: number): number {
  const requested = explicit ?? envIntOptional("REFACTOR_TASKS_SENTRY_CHUNK_SIZE") ?? 0;
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
}

export async function reportFindings(
  findings: ScanFinding[],
  dsn: string,
  options: ReportOptions = {},
): Promise<void> {
  initSentry(dsn);

  const chunkSize = resolveChunkSize(options.chunkSize);

  if (chunkSize <= 0) {
    for (const finding of findings) {
      reportFinding(finding);
    }
    log(`Reported ${findings.length} findings to Sentry (single batch)`);
    await Sentry.flush(FLUSH_TIMEOUT_MS);
    return;
  }

  const total = findings.length;
  let flushTimeouts = 0;

  for (let start = 0; start < total; start += chunkSize) {
    const chunk = findings.slice(start, start + chunkSize);
    for (const finding of chunk) {
      reportFinding(finding);
    }

    // Flush each chunk before queuing the next so the transport can apply
    // 429 backoff between bursts instead of dropping a firehose of events.
    const drained = await Sentry.flush(FLUSH_TIMEOUT_MS);
    if (!drained) {
      flushTimeouts++;
      verbose(`Flush timed out for chunk ending at ${Math.min(start + chunkSize, total)}/${total}`);
    }

    log(`Reported ${Math.min(start + chunkSize, total)}/${total} findings to Sentry`);

    if (start + chunkSize < total) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  if (flushTimeouts > 0) {
    log(
      `Warning: ${flushTimeouts} chunk flush(es) timed out — some findings may have been dropped. ` +
        `Increase REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS or the project's rate limit and re-run.`,
    );
  }
}
