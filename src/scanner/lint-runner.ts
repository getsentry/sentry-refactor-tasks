import { appendFile, readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { ResolvedRepoConfig, Pattern } from "../config/schemas.ts";
import { execShellPermissive } from "../utils/exec.ts";
import { verbose, log } from "../utils/logger.ts";
import { prepareCommand, describeCommand } from "./command-template.ts";
import type { RawFinding } from "./result.ts";

// Keep the tail, not the head: die()-style diagnostics put the actual
// reason last, after any setup/install noise.
const STDERR_TAIL_LIMIT = 4000;

function truncateStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= STDERR_TAIL_LIMIT) return trimmed;
  return `[...truncated, showing last ${STDERR_TAIL_LIMIT} characters...]\n${trimmed.slice(-STDERR_TAIL_LIMIT)}`;
}

// Safety net independent of any individual detect script remembering to
// mirror its own diagnostics to $GITHUB_STEP_SUMMARY.
async function reportDetectFailure(pattern: Pattern, stderr: string): Promise<void> {
  if (!stderr.trim()) return;

  const diagnostic = truncateStderr(stderr);
  log(`  Detect command stderr:\n${diagnostic}`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    await appendFile(
      summaryPath,
      `\n\n### Detect command failed: ${pattern.name}\n\n\`\`\`\n${diagnostic}\n\`\`\`\n`,
    );
  } catch (err) {
    verbose(`  Failed to write to GITHUB_STEP_SUMMARY: ${err}`);
  }
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

  const { stdout, stderr } = await execShellPermissive(prepared.command, {
    timeout: 300_000,
    cwd: config.path,
    env: prepared.env,
  });

  if (!stdout.trim()) {
    log(`  Detect command produced no output`);
    await reportDetectFailure(pattern, stderr);
    return [];
  }

  let results: EslintFileResult[];
  try {
    results = JSON.parse(stdout) as EslintFileResult[];
  } catch {
    log(`  Failed to parse detect command output as JSON`);
    verbose(`  Output head: ${stdout.slice(0, 200)}`);
    await reportDetectFailure(pattern, stderr);
    return [];
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
