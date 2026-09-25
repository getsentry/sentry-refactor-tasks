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
