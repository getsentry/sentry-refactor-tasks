import { matchesGlob, relative } from "node:path";
import fg from "fast-glob";

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

// Filters a list of absolute file paths against a set of exclude glob patterns.
// Converts each path to a repo-relative form before matching, so patterns like
// "**/*.spec.*" behave the same way as the ignore option in findFiles().
export function filterExcluded(
  files: string[],
  repoPath: string,
  exclude: string[],
): string[] {
  if (exclude.length === 0) {
    return files;
  }
  return files.filter((file) => {
    const rel = relative(repoPath, file);
    return !exclude.some((pattern) => matchesGlob(rel, pattern));
  });
}
