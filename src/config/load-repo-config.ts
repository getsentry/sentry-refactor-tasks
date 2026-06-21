import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { RepoConfigSchema, type RepoConfig } from "./schemas.ts";

export async function loadRepoConfig(repoName: string): Promise<RepoConfig> {
  const configPath = join(import.meta.dirname, "..", "..", "repos", repoName, "repo.yaml");
  const raw = await readFile(configPath, "utf-8");
  const parsed = parse(raw);
  return RepoConfigSchema.parse(parsed);
}

export function reposDir(): string {
  return join(import.meta.dirname, "..", "..", "repos");
}
