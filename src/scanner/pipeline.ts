import pLimit from "p-limit";
import type { CheckedOutRepoConfig, Pattern } from "../config/schemas.ts";
import { exec } from "../utils/exec.ts";
import { verbose, log } from "../utils/logger.ts";
import { getFilesToScan } from "./prefilter.ts";
import { analyzeWithClaude, readFilesForAnalysis, type FileContent } from "./claude.ts";
import { runDetectCommand } from "./lint-runner.ts";
import {
  hydrateFinding,
  deduplicateFindings,
  correctLineNumbers,
  type ScanFinding,
  type RawFinding,
} from "./result.ts";
import { ScanCache, hashContent } from "./scan-cache.ts";

async function resolveGitSha(repoPath: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repoPath });
  return stdout.trim();
}

const MAX_FILES_PER_BATCH = 20;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_TOKENS_PER_BATCH = 80_000;

function batchFiles(files: FileContent[]): FileContent[][] {
  const batches: FileContent[][] = [];
  let currentBatch: FileContent[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const fileTokens = Math.ceil(file.content.length / APPROX_CHARS_PER_TOKEN);

    if (
      currentBatch.length >= MAX_FILES_PER_BATCH ||
      (currentTokens + fileTokens > MAX_TOKENS_PER_BATCH && currentBatch.length > 0)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(file);
    currentTokens += fileTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function scanWithDetectCommand(
  pattern: Pattern,
  config: CheckedOutRepoConfig,
  gitSha: string,
): Promise<RawFinding[]> {
  log(`  Using detect command (no LLM)`);
  return runDetectCommand(pattern, config);
}

async function scanWithLlm(
  pattern: Pattern,
  config: CheckedOutRepoConfig,
  repoName: string,
  model: string,
  files: string[],
): Promise<{ findings: RawFinding[]; contentsByRelPath: Map<string, string> }> {
  const cache = new ScanCache(repoName, pattern.name);
  await cache.load();

  const allFileContents = await readFilesForAnalysis(files, config.path);

  const cachedFindings: RawFinding[] = [];
  const uncachedFiles: FileContent[] = [];

  for (const file of allFileContents) {
    const hash = hashContent(file.content);
    const cached = cache.lookup(file.relativePath, hash);
    if (cached) {
      cachedFindings.push(...cached);
    } else {
      uncachedFiles.push(file);
    }
  }

  const cacheHits = allFileContents.length - uncachedFiles.length;
  if (cacheHits > 0) {
    log(`  Cache: ${cacheHits} files cached, ${uncachedFiles.length} need analysis`);
  }

  const llmFindings: RawFinding[] = [];

  if (uncachedFiles.length > 0) {
    const batches = batchFiles(uncachedFiles);
    verbose(`  Split ${uncachedFiles.length} uncached files into ${batches.length} batches`);

    const limit = pLimit(config.scan_concurrency);

    const results = await Promise.all(
      batches.map((batch, i) =>
        limit(async () => {
          verbose(`  Processing batch ${i + 1}/${batches.length}`);
          const response = await analyzeWithClaude(pattern, batch, model);
          return { batch, response };
        }),
      ),
    );

    for (const { batch, response } of results) {
      for (const file of batch) {
        const hash = hashContent(file.content);
        const fileFindings = response.findings.filter((f) => f.file === file.relativePath);
        cache.store(file.relativePath, hash, fileFindings);
        llmFindings.push(...fileFindings);
      }
    }

    await cache.save();
  }

  const contentsByRelPath = new Map(allFileContents.map((f) => [f.relativePath, f.content]));
  return { findings: [...cachedFindings, ...llmFindings], contentsByRelPath };
}

export async function scanPattern(
  pattern: Pattern,
  config: CheckedOutRepoConfig,
  repoName: string,
  options: { model?: string; dryRun?: boolean },
): Promise<ScanFinding[]> {
  const model = options.model ?? config.default_model;
  const gitSha = await resolveGitSha(config.path);
  const usesDetectCommand = Boolean(pattern.detect_command);

  log(`Scanning for "${pattern.name}" in ${config.repo} @ ${gitSha.slice(0, 8)}...`);

  if (!usesDetectCommand) {
    const files = await getFilesToScan(pattern, config, repoName);
    log(`  Found ${files.length} candidate files`);

    if (options.dryRun) {
      files.slice(0, 10).forEach((f) => log(`    ${f}`));
      if (files.length > 10) log(`    ... and ${files.length - 10} more`);
      return [];
    }

    if (files.length === 0) return [];

    const { findings, contentsByRelPath } = await scanWithLlm(
      pattern,
      config,
      repoName,
      model,
      files,
    );
    const corrected = findings.map((f) => {
      const content = contentsByRelPath.get(f.file);
      return content ? correctLineNumbers(f, content) : f;
    });
    const hydrated = corrected.map((f) => hydrateFinding(f, pattern, config.repo, gitSha));
    const deduped = deduplicateFindings(hydrated);
    log(`  Found ${deduped.length} violations`);
    return deduped;
  }

  // detect_command path — line numbers come from the tool, no correction needed
  if (options.dryRun) {
    log(`  Would run detect command: ${pattern.detect_command}`);
    return [];
  }

  const rawFindings = await scanWithDetectCommand(pattern, config, gitSha);
  const hydrated = rawFindings.map((f) => hydrateFinding(f, pattern, config.repo, gitSha));
  const deduped = deduplicateFindings(hydrated);
  log(`  Found ${deduped.length} violations`);
  return deduped;
}

export async function scanRepo(
  patterns: Pattern[],
  config: CheckedOutRepoConfig,
  repoName: string,
  options: { model?: string; dryRun?: boolean; patternFilter?: string },
): Promise<ScanFinding[]> {
  const toScan = options.patternFilter
    ? patterns.filter((p) => p.name === options.patternFilter)
    : patterns;

  if (toScan.length === 0) {
    log("No matching patterns found.");
    return [];
  }

  const allFindings: ScanFinding[] = [];
  for (const pattern of toScan) {
    const findings = await scanPattern(pattern, config, repoName, options);
    allFindings.push(...findings);
  }

  return allFindings;
}
