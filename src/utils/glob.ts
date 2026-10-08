import fg from "fast-glob";

export async function findFiles(
  repoPath: string,
  include?: string[],
  exclude?: string[],
): Promise<string[]> {
  const patterns = include ?? ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];
  return fg(patterns, {
    cwd: repoPath,
    // Without an `include`, the default patterns would otherwise walk every
    // installed dependency.
    ignore: ["**/node_modules/**", ...(exclude ?? [])],
    absolute: true,
    dot: false,
  });
}
