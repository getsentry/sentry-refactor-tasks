import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { RawFinding } from "./result.ts";
import { verbose } from "../utils/logger.ts";

interface CacheEntry {
  content_hash: string;
  findings: RawFinding[];
}

interface CacheFile {
  [relativePath: string]: CacheEntry;
}

function cacheDir(): string {
  return join(import.meta.dirname, "..", "..", "cache");
}

function cachePath(repoName: string, patternName: string): string {
  return join(cacheDir(), repoName, "scan-results", `${patternName}.json`);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class ScanCache {
  private entries: CacheFile = {};
  private dirty = false;
  private filePath: string;

  constructor(repoName: string, patternName: string) {
    this.filePath = cachePath(repoName, patternName);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.entries = JSON.parse(raw) as CacheFile;
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
    await writeFile(this.filePath, JSON.stringify(this.entries, null, 2), "utf-8");
    verbose(`Saved scan cache: ${Object.keys(this.entries).length} entries`);
  }
}
