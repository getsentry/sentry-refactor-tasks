import { resolveRepo } from "../config/resolve-repo.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";

export async function listCommand(options: { cwd?: string }): Promise<void> {
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);

  console.log(`Conventions for ${config.repo} (${config.path}):`);
  for (const p of patterns) {
    const tagStr = p.tags.length ? ` [${p.tags.join(", ")}]` : "";
    console.log(`  ${p.severity.toUpperCase().padEnd(7)} ${p.name}${tagStr}`);
  }
  console.log(`\n${patterns.length} conventions configured`);
}
