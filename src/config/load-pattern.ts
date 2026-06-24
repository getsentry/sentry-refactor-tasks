import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { conventionsDir } from "./paths.ts";
import { PatternSchema, type Pattern } from "./schemas.ts";

export async function loadPattern(filePath: string): Promise<Pattern> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = parse(raw);
  return PatternSchema.parse(parsed);
}

export async function loadAllPatterns(repoRoot: string): Promise<Pattern[]> {
  const dir = conventionsDir(repoRoot);
  const files = await readdir(dir);
  const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return Promise.all(yamlFiles.map((f) => loadPattern(join(dir, f))));
}
