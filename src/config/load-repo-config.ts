import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./paths.ts";
import { RepoConfigSchema, type RepoConfig } from "./schemas.ts";

export async function loadRepoConfig(repoRoot: string): Promise<RepoConfig> {
  const configPath = join(configDir(repoRoot), "repo.yaml");
  const raw = await readFile(configPath, "utf-8");
  const parsed = parse(raw);
  return RepoConfigSchema.parse(parsed);
}
