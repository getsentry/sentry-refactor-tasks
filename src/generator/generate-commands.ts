import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CheckedOutRepoConfig, Pattern } from "../config/schemas.ts";
import { exec } from "../utils/exec.ts";
import { log, verbose } from "../utils/logger.ts";

function cacheDir(): string {
  return join(import.meta.dirname, "..", "..", "cache");
}

function buildGenerationPrompt(pattern: Pattern, config: CheckedOutRepoConfig): string {
  let prompt = `Given this code pattern description, generate a single shell command (using grep, ripgrep, find, or similar) that finds files likely containing this pattern.

The command should:
- Be fast and have high recall (false positives are OK, the LLM will filter later)
- Output one file path per line
- Search within: ${config.path}`;

  if (pattern.include?.length) {
    prompt += `\n- Only search in files matching: ${pattern.include.join(", ")}`;
  }
  if (pattern.exclude?.length) {
    prompt += `\n- Exclude paths matching: ${pattern.exclude.join(", ")}`;
  }

  prompt += `

Pattern name: ${pattern.name}
Detection instructions: ${pattern.detect}

Output ONLY the shell command, nothing else. No explanation, no markdown fences.`;

  return prompt;
}

export async function generatePrefilterCommand(
  pattern: Pattern,
  config: CheckedOutRepoConfig,
  repoName: string,
): Promise<string> {
  const prompt = buildGenerationPrompt(pattern, config);

  verbose(`Generating prefilter command for "${pattern.name}"`);

  const { stdout } = await exec("claude", ["--print", prompt, "--model", "haiku"], {
    timeout: 60_000,
  });

  const response = JSON.parse(stdout);
  const command = (response.result ?? stdout).trim();

  const cachePath = join(cacheDir(), repoName, `${pattern.name}.sh`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, command, "utf-8");

  log(`Generated prefilter for "${pattern.name}" → ${cachePath}`);
  return command;
}

export async function generateAllCommands(
  patterns: Pattern[],
  config: CheckedOutRepoConfig,
  repoName: string,
): Promise<void> {
  const needsGeneration = patterns.filter((p) => !p.prefilter);

  if (needsGeneration.length === 0) {
    log("All patterns already have prefilter commands.");
    return;
  }

  log(`Generating prefilter commands for ${needsGeneration.length} patterns...`);

  for (const pattern of needsGeneration) {
    await generatePrefilterCommand(pattern, config, repoName);
  }
}
