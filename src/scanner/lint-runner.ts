import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { ResolvedRepoConfig, Pattern } from "../config/schemas.ts";
import { execShellPermissive, type PermissiveExecResult } from "../utils/exec.ts";
import { verbose, log, logToStepSummary } from "../utils/logger.ts";
import { prepareCommand, describeCommand, type PreparedCommand } from "./command-template.ts";
import type { RawFinding } from "./result.ts";

// The scanner kills a detect command after this long; a SIGTERM at exactly
// this budget is almost certainly the kill, not the command's own choice.
const DETECT_COMMAND_TIMEOUT_MS = 300_000;

export class DetectCommandError extends Error {}

function describeExit(result: PermissiveExecResult): string {
  if (result.signal) {
    const timeoutNote =
      result.signal === "SIGTERM"
        ? ` (the scanner kills detect commands after ${DETECT_COMMAND_TIMEOUT_MS / 1000}s — this may be that timeout)`
        : "";
    return `killed by ${result.signal}${timeoutNote}`;
  }
  return `exited with code ${result.code ?? "n/a"}`;
}

/**
 * Log and throw on a detect command that can't be trusted. Never let a
 * detect command's failure degrade into "0 violations": that indistinguishably
 * masked a fully broken `no-deprecated-callsite` rule in getsentry/sentry for
 * weeks (CI said 0, a local run found 1608) because the scanner previously
 * read only stdout and discarded both stderr and the exit code.
 */
function fail(
  pattern: Pattern,
  prepared: PreparedCommand,
  reason: string,
  result: PermissiveExecResult,
): never {
  const stderr = result.stderr.trim();
  const message = [
    `Detect command for "${pattern.name}" failed: ${reason}`,
    `command: ${describeCommand(prepared)}`,
    `exit: ${describeExit(result)}`,
    `stderr:\n${stderr || "(empty)"}`,
  ].join("\n");
  log(`  ${message}`);
  logToStepSummary(`refactor-tasks: "${pattern.name}" detect command failed`, message);
  throw new DetectCommandError(message);
}

interface EslintMessage {
  ruleId: string;
  message: string;
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

function extractSnippet(fileContent: string, line: number, endLine: number): string {
  const lines = fileContent.split("\n");
  const start = Math.max(0, line - 1);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start, end).join("\n");
}

export async function runDetectCommand(
  pattern: Pattern,
  config: ResolvedRepoConfig,
): Promise<RawFinding[]> {
  const prepared = prepareCommand(pattern.detect_command!, config.path);
  verbose(`Running detect command: ${describeCommand(prepared)}`);

  const result = await execShellPermissive(prepared.command, {
    timeout: DETECT_COMMAND_TIMEOUT_MS,
    cwd: config.path,
    env: prepared.env,
  });

  // A clean run always writes at least `[]` to stdout — empty stdout means the
  // command never produced a trustworthy result, regardless of its exit code.
  if (!result.stdout.trim()) {
    fail(pattern, prepared, "produced no output on stdout", result);
  }

  let results: EslintFileResult[];
  try {
    results = JSON.parse(result.stdout) as EslintFileResult[];
  } catch {
    fail(
      pattern,
      prepared,
      `output was not valid JSON (first 200 chars: ${result.stdout.slice(0, 200)})`,
      result,
    );
  }

  // Output parsed, but the process still exited abnormally (e.g. it flushed
  // partial output before being OOM-killed or hitting the scanner's timeout).
  // A parseable result isn't the same as a complete one.
  if (result.code !== 0 || result.signal !== null) {
    fail(
      pattern,
      prepared,
      "wrote output but exited abnormally; result set may be incomplete",
      result,
    );
  }

  const findings: RawFinding[] = [];

  for (const fileResult of results) {
    if (fileResult.messages.length === 0) continue;

    const relPath = relative(config.path, fileResult.filePath);
    let fileContent: string | undefined;
    try {
      fileContent = await readFile(fileResult.filePath, "utf-8");
    } catch {
      // file read failed, snippets will be empty
    }

    for (const msg of fileResult.messages) {
      const endLine = msg.endLine ?? msg.line;
      findings.push({
        file: relPath,
        line_start: msg.line,
        line_end: endLine,
        snippet: fileContent ? extractSnippet(fileContent, msg.line, endLine) : "",
        confidence: "high",
        explanation: msg.message,
      });
    }
  }

  return findings;
}
