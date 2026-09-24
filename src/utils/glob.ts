import fg from "fast-glob";
import { matchesGlob, relative } from "node:path";

export async function findFiles(
  repoPath: string,
  include?: string[],
  exclude?: string[],
): Promise<string[]> {
  const patterns = include ?? ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
  return fg(patterns, {
    cwd: repoPath,
    ignore: exclude ?? [],
    absolute: true,
    dot: false,
  });
}

/**
 * Filters a list of absolute file paths against a set of exclude glob patterns.
 * Paths are matched against patterns using their relative form from repoPath,
 * so patterns like `**‌/*.spec.*` work the same way as in findFiles().
 */
export function filterExcluded(
  files: string[],
  repoPath: string,
  exclude: string[],
): string[] {
  if (!exclude.length) return files;
  return files.filter(
    file => !exclude.some(pattern => matchesGlob(relative(repoPath, file), pattern)),
  );
}
