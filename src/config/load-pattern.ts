import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { PatternSchema, type Pattern } from "./schemas.ts";

export async function loadPattern(filePath: string): Promise<Pattern> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = parse(raw);
  return PatternSchema.parse(parsed);
}

export async function loadAllPatterns(repoName: string): Promise<Pattern[]> {
  const conventionsDir = join(import.meta.dirname, "..", "..", "repos", repoName, "conventions");
  const files = await readdir(conventionsDir);
  const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return Promise.all(yamlFiles.map((f) => loadPattern(join(conventionsDir, f))));
}
