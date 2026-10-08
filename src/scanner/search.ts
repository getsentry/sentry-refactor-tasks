import { readFile } from "node:fs/promises";
import pLimit from "p-limit";
import type { Search } from "../config/schemas.ts";
import { findFiles } from "../utils/glob.ts";
import { verbose } from "../utils/logger.ts";

// Bounds open file handles; reading a large repo is otherwise one burst of opens.
const READ_CONCURRENCY = 64;

/**
 * Files under `include`/`exclude` with at least one line matching `match`.
 * Searching in-process keeps one regex dialect for picking files and for
 * excerpting them, so the two can't disagree about what matched.
 */
export async function findCandidateFiles(search: Search, repoPath: string): Promise<string[]> {
  const match = new RegExp(search.match);
  const files = await findFiles(repoPath, search.include, search.exclude);
  verbose(`Searching ${files.length} files for /${search.match}/`);

  const limit = pLimit(READ_CONCURRENCY);
  const hits = await Promise.all(
    files.map((file) =>
      limit(async () => {
        const content = await readFile(file, "utf-8");
        return content.split("\n").some((line) => match.test(line)) ? file : null;
      }),
    ),
  );
  return hits.filter((file): file is string => file !== null);
}
