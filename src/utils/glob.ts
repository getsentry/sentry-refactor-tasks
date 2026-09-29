import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import micromatch from "micromatch";

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

// The options fast-glob hands micromatch for `findFiles`, so a path list filtered
// here agrees with what the glob walk would have returned.
const MATCH_OPTIONS = { posix: true, strictSlashes: false };

function normalize(patterns: string[]): string[] {
  return patterns
    .flatMap((pattern) => micromatch.braces(pattern, { expand: true, nodupes: true }))
    .filter((pattern) => pattern !== "")
    .map((pattern) => pattern.replace(/(?!^)\/{2,}/g, "/"));
}

function compile(patterns: string[], dot: boolean): (path: string) => boolean {
  const res = patterns.map((pattern) => micromatch.makeRe(pattern, { ...MATCH_OPTIONS, dot }));
  return (path) => res.some((re) => re.test(path));
}

// fast-glob stops descending into a directory that matches an exclude pattern
// ending in `/**` or naming a literal final segment, so `static/gsAdmin` drops
// everything below it even though no file path matches it.
function prunesDirectories(pattern: string): boolean {
  return pattern.endsWith("/**") || !fg.isDynamicPattern(posix.basename(pattern));
}

function parentDirectories(relativePath: string): string[] {
  const segments = relativePath.split("/");
  return segments.slice(1).map((_, i) => segments.slice(0, i + 1).join("/"));
}

/**
 * Apply include/exclude globs to a file list that didn't come from `findFiles`,
 * such as a prefilter command's output, with the rules fast-glob uses:
 * include patterns skip dotfiles, exclude patterns don't, `!`-prefixed include
 * entries act as excludes, absolute exclude patterns match the absolute path,
 * and excluded directories drop everything beneath them.
 *
 * Paths are resolved against the repo, since commands run with it as their cwd,
 * and returned absolute and deduplicated. Paths outside the repo are dropped.
 *
 * Without `include`, only `exclude` applies: the command already chose the file
 * set, and `findFiles`' default extensions exist only to bound a full walk.
 */
export function filterFiles(
  repoPath: string,
  files: string[],
  include?: string[],
  exclude?: string[],
): string[] {
  const positive = normalize((include ?? []).filter((pattern) => !pattern.startsWith("!")));
  const negative = normalize([
    ...(exclude ?? []),
    ...(include ?? []).filter((pattern) => pattern.startsWith("!")).map((p) => p.slice(1)),
  ]);
  const relativeNegative = negative.filter((pattern) => !isAbsolute(pattern));
  const isIncluded = compile(positive, false);
  const isExcludedRelative = compile(relativeNegative, true);
  const isExcludedAbsolute = compile(negative.filter(isAbsolute), true);
  const isExcludedDirectory = compile(relativeNegative.filter(prunesDirectories), false);

  const kept = new Set<string>();
  for (const file of files) {
    const absolutePath = resolve(repoPath, file);
    const relativePath = relative(repoPath, absolutePath).split(sep).join("/");
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) continue;
    if (positive.length > 0 && !isIncluded(relativePath)) continue;
    if (isExcludedRelative(relativePath) || isExcludedAbsolute(absolutePath)) continue;
    if (parentDirectories(relativePath).some(isExcludedDirectory)) continue;
    kept.add(absolutePath);
  }
  return [...kept];
}
