import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { RawFinding } from "./result.ts";
import { cacheDir } from "../utils/cache-dir.ts";
import { verbose } from "../utils/logger.ts";

interface CacheEntry {
  content_hash: string;
  findings: RawFinding[];
}

interface CacheFile {
  fingerprint: string;
  files: Record<string, CacheEntry>;
}

function cachePath(slug: string, patternName: string): string {
  return join(cacheDir(), slug, "scan-results", `${patternName}.json`);
}

/** Filesystem-safe key for a repo (e.g. "getsentry/sentry" → "getsentry-sentry"). */
export function repoSlug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class ScanCache {
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;
  private filePath: string;
  private fingerprint: string;

  /**
   * `fingerprint` identifies everything besides file contents that shaped the
   * results: the prompt, the model and how files were batched.
   * A cache written under a different one is discarded whole, since every
   * entry in it answered a different question.
   */
  constructor(slug: string, patternName: string, fingerprint: string) {
    this.filePath = cachePath(slug, patternName);
    this.fingerprint = fingerprint;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as Partial<CacheFile>;
      if (raw.fingerprint !== this.fingerprint || !raw.files) {
        verbose(`Scan cache was written for a different prompt, model or batch size; ignoring it`);
        this.entries = {};
        return;
      }
      this.entries = raw.files;
      verbose(`Loaded scan cache: ${Object.keys(this.entries).length} entries`);
    } catch {
      this.entries = {};
    }
  }

  lookup(relativePath: string, contentHash: string): RawFinding[] | null {
    const entry = this.entries[relativePath];
    if (entry && entry.content_hash === contentHash) {
      return entry.findings;
    }
    return null;
  }

  store(relativePath: string, contentHash: string, findings: RawFinding[]): void {
    this.entries[relativePath] = { content_hash: contentHash, findings };
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const file: CacheFile = { fingerprint: this.fingerprint, files: this.entries };
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf-8");
    verbose(`Saved scan cache: ${Object.keys(this.entries).length} entries`);
  }
}
