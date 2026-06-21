import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Pattern } from "../config/schemas.ts";
import { findingsJsonSchema, FindingsResponseSchema } from "../config/schemas.ts";
import type { FindingsResponse } from "../config/schemas.ts";
import { exec } from "../utils/exec.ts";
import { verbose } from "../utils/logger.ts";

export interface FileContent {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export async function readFilesForAnalysis(
  filePaths: string[],
  repoPath: string,
): Promise<FileContent[]> {
  return Promise.all(
    filePaths.map(async (absolutePath) => ({
      absolutePath,
      relativePath: relative(repoPath, absolutePath),
      content: await readFile(absolutePath, "utf-8"),
    })),
  );
}

function buildPrompt(pattern: Pattern, files: FileContent[]): string {
  const fileBlock = files
    .map((f) => `--- ${f.relativePath} ---\n${f.content}\n--- end ---`)
    .join("\n\n");

  let prompt = `Analyze the following source files for this code pattern violation:

**Pattern:** ${pattern.name}
**What to detect:** ${pattern.detect}`;

  if (pattern.examples?.bad.length) {
    prompt += `\n**Bad examples (violations):**\n${pattern.examples.bad.map((e) => `- \`${e}\``).join("\n")}`;
  }
  if (pattern.examples?.good.length) {
    prompt += `\n**Good examples (NOT violations):**\n${pattern.examples.good.map((e) => `- \`${e}\``).join("\n")}`;
  }

  prompt += `\n\n**Source files to analyze:**\n\n${fileBlock}`;
  prompt += `\n\nFor each violation found, report the file path (relative), line numbers, a code snippet, your confidence level, and a brief explanation. If no violations are found, return an empty findings array.`;

  return prompt;
}

function buildSystemPrompt(): string {
  return "You are a code reviewer checking for specific anti-patterns. Be precise: only flag actual violations, not similar-looking but correct code. When uncertain, prefer false negatives over false positives. Report confidence honestly.";
}

export async function analyzeWithClaude(
  pattern: Pattern,
  files: FileContent[],
  model: string,
): Promise<FindingsResponse> {
  const prompt = buildPrompt(pattern, files);
  const systemPrompt = buildSystemPrompt();
  const schema = JSON.stringify(findingsJsonSchema);

  verbose(`Analyzing ${files.length} files for pattern "${pattern.name}" with model "${model}"`);

  const { stdout } = await exec(
    "claude",
    [
      "--print",
      prompt,
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--append-system-prompt",
      systemPrompt,
      "--model",
      model,
    ],
    { timeout: 120_000 },
  );

  const response = JSON.parse(stdout);
  const structured = response.structured_output ?? JSON.parse(response.result);
  return FindingsResponseSchema.parse(structured);
}
