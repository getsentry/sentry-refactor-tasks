import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { ResolvedRepoConfig, Pattern } from "../config/schemas.ts";
import { execShellPermissive } from "../utils/exec.ts";
import { verbose, log } from "../utils/logger.ts";
import { prepareCommand, describeCommand } from "./command-template.ts";
import type { RawFinding } from "./result.ts";

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

  const { stdout } = await execShellPermissive(prepared.command, {
    timeout: 300_000,
    cwd: config.path,
    env: prepared.env,
  });

  if (!stdout.trim()) {
    log(`  Detect command produced no output`);
    return [];
  }

  let results: EslintFileResult[];
  try {
    results = JSON.parse(stdout) as EslintFileResult[];
  } catch {
    log(`  Failed to parse detect command output as JSON`);
    verbose(`  Output head: ${stdout.slice(0, 200)}`);
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
