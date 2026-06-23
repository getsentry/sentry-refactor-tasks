import { readdir } from "node:fs/promises";
import { reposDir } from "../config/load-repo-config.ts";
import { loadRepoConfig } from "../config/load-repo-config.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";

export async function listCommand(repoName?: string): Promise<void> {
  if (!repoName) {
    const repos = await readdir(reposDir());
    const dirs = repos.filter((r) => !r.startsWith("."));
    console.log("Configured repos:");
    for (const dir of dirs) {
      try {
        const config = await loadRepoConfig(dir);
        console.log(`  ${dir} → ${config.repo} (${config.git_url})`);
      } catch {
        console.log(`  ${dir} → (invalid config)`);
      }
    }
    return;
  }

  const patterns = await loadAllPatterns(repoName);
  const config = await loadRepoConfig(repoName);
  console.log(`Patterns for ${config.repo}:`);
  for (const p of patterns) {
    const tagStr = p.tags.length ? ` [${p.tags.join(", ")}]` : "";
    console.log(`  ${p.severity.toUpperCase().padEnd(7)} ${p.name}${tagStr}`);
  }
  console.log(`\n${patterns.length} patterns configured`);
}
