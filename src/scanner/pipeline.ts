import pLimit from "p-limit";
import type { ResolvedRepoConfig, Pattern, Search } from "../config/schemas.ts";
import { exec } from "../utils/exec.ts";
import { verbose, log } from "../utils/logger.ts";
import { findCandidateFiles } from "./search.ts";
import {
  analyzeWithClaude,
  promptFingerprint,
  readFilesForAnalysis,
  type FileContent,
} from "./claude.ts";
import { excerptContent } from "./excerpt.ts";
import { runDetectCommand } from "./lint-runner.ts";
import {
  hydrateFinding,
  deduplicateFindings,
  locateFinding,
  type ScanFinding,
  type RawFinding,
} from "./result.ts";
import { ScanCache, hashContent, repoSlug } from "./scan-cache.ts";

async function resolveGitSha(repoPath: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repoPath });
  return stdout.trim();
}

const MAX_FILES_PER_BATCH = 20;
// Source code tokenizes far denser than prose (~2.4 chars/token measured on
// TS/TSX), and Haiku 5.5 bills 5x for prompts of 100k+ tokens. Underestimating
// here pushed batches past that line, where most of a scan's cost went.
const APPROX_CHARS_PER_TOKEN = 2.4;
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
  config: ResolvedRepoConfig,
): Promise<RawFinding[]> {
  log(`  Using detect command (no LLM)`);
  return runDetectCommand(pattern, config);
}

async function scanWithLlm(
  pattern: Pattern,
  search: Search,
  config: ResolvedRepoConfig,
  model: string,
  files: string[],
): Promise<{ findings: RawFinding[]; contentsByRelPath: Map<string, string> }> {
  const cache = new ScanCache(
    repoSlug(config.repo),
    pattern.name,
    promptFingerprint(pattern, model),
  );
  await cache.load();

  const allFileContents = await readFilesForAnalysis(files, config.path);

  const cachedFindings: RawFinding[] = [];
  const uncachedFiles: FileContent[] = [];
  // Keyed on the whole file, since the excerpt sent to the model is derived from it.
  const hashes = new Map<string, string>();

  for (const file of allFileContents) {
    const hash = hashContent(file.content);
    hashes.set(file.relativePath, hash);
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
    const { match, excerpt } = search;
    const toSend =
      excerpt === undefined
        ? uncachedFiles
        : uncachedFiles.map((f) => ({ ...f, content: excerptContent(f.content, match, excerpt) }));
    const batches = batchFiles(toSend);
    verbose(`  Split ${uncachedFiles.length} uncached files into ${batches.length} batches`);

    const limit = pLimit(config.scan_concurrency);

    const results = await Promise.all(
      batches.map((batch, i) =>
        limit(async () => {
          verbose(`  Processing batch ${i + 1}/${batches.length}`);
          const findings = await analyzeWithClaude(pattern, batch, model);
          return { batch, findings };
        }),
      ),
    );

    for (const { batch, findings } of results) {
      for (const file of batch) {
        const fileFindings = findings.filter((f) => f.file === file.relativePath);
        cache.store(file.relativePath, hashes.get(file.relativePath)!, fileFindings);
        llmFindings.push(...fileFindings);
      }
    }

    await cache.save();
  }

  const contentsByRelPath = new Map(allFileContents.map((f) => [f.relativePath, f.content]));
  return { findings: [...cachedFindings, ...llmFindings], contentsByRelPath };
}

async function scanPattern(
  pattern: Pattern,
  config: ResolvedRepoConfig,
  options: { model?: string; dryRun?: boolean },
): Promise<ScanFinding[]> {
  const model = options.model ?? config.default_model;
  const gitSha = await resolveGitSha(config.path);
  const { search } = pattern;
  const startTime = performance.now();
  const elapsedSeconds = () => ((performance.now() - startTime) / 1000).toFixed(1);

  log(`Scanning for "${pattern.name}" in ${config.repo} @ ${gitSha.slice(0, 8)}...`);

  if (search) {
    const files = await findCandidateFiles(search, config.path);
    log(`  Found ${files.length} candidate files`);

    if (options.dryRun) {
      files.slice(0, 10).forEach((f) => log(`    ${f}`));
      if (files.length > 10) log(`    ... and ${files.length - 10} more`);
      return [];
    }

    if (files.length === 0) return [];

    const { findings, contentsByRelPath } = await scanWithLlm(
      pattern,
      search,
      config,
      model,
      files,
    );
    const located = findings.flatMap((f) => {
      const content = contentsByRelPath.get(f.file);
      const finding = content === undefined ? null : locateFinding(f, content);
      return finding ? [finding] : [];
    });
    if (located.length < findings.length) {
      verbose(
        `  Dropped ${findings.length - located.length} findings whose snippet isn't in the file`,
      );
    }
    const hydrated = located.map((f) => hydrateFinding(f, pattern, config.repo, gitSha));
    const deduped = deduplicateFindings(hydrated);
    log(`  Found ${deduped.length} violations (${elapsedSeconds()}s)`);
    return deduped;
  }

  // detect_command path — line numbers come from the tool, no correction needed
  if (options.dryRun) {
    log(`  Would run detect command: ${pattern.detect_command}`);
    return [];
  }

  const rawFindings = await scanWithDetectCommand(pattern, config);
  const hydrated = rawFindings.map((f) => hydrateFinding(f, pattern, config.repo, gitSha));
  const deduped = deduplicateFindings(hydrated);
  log(`  Found ${deduped.length} violations (${elapsedSeconds()}s)`);
  return deduped;
}

export interface PatternFailure {
  pattern: string;
  message: string;
}

export interface ScanRepoResult {
  findings: ScanFinding[];
  // One pattern's detect command blowing up must not cost the findings every
  // other pattern already found, or hide that it happened — so a failure is
  // recorded here and scanning continues, rather than throwing mid-loop.
  failures: PatternFailure[];
}

export async function scanRepo(
  patterns: Pattern[],
  config: ResolvedRepoConfig,
  options: {
    model?: string;
    dryRun?: boolean;
    patternFilter?: string;
    // Invoked with each pattern's findings as soon as that pattern finishes, so
    // callers can stream results (e.g. report to Sentry in chunks) instead of
    // waiting for the whole scan. Awaited, so it also applies backpressure.
    onFindings?: (findings: ScanFinding[]) => Promise<void> | void;
  },
): Promise<ScanRepoResult> {
  const toScan = options.patternFilter
    ? patterns.filter((p) => p.name === options.patternFilter)
    : patterns;

  if (toScan.length === 0) {
    log("No matching patterns found.");
    return { findings: [], failures: [] };
  }

  const totalStart = performance.now();
  const allFindings: ScanFinding[] = [];
  const failures: PatternFailure[] = [];
  for (const pattern of toScan) {
    let findings: ScanFinding[];
    try {
      findings = await scanPattern(pattern, config, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  Skipping "${pattern.name}" after failure: ${message}`);
      failures.push({ pattern: pattern.name, message });
      continue;
    }
    allFindings.push(...findings);
    if (findings.length > 0 && options.onFindings) {
      await options.onFindings(findings);
    }
  }

  if (toScan.length > 1) {
    log(
      `Scanned ${toScan.length} patterns in ${((performance.now() - totalStart) / 1000).toFixed(1)}s`,
    );
  }

  if (failures.length > 0) {
    log(
      `${failures.length}/${toScan.length} pattern(s) failed to scan: ${failures.map((f) => f.pattern).join(", ")}`,
    );
  }

  return { findings: allFindings, failures };
}
