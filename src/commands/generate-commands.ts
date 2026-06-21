import { loadRepoConfig } from "../config/load-repo-config.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { generateAllCommands } from "../generator/generate-commands.ts";

export async function generateCommandsCommand(repoName: string): Promise<void> {
  const config = await loadRepoConfig(repoName);
  const patterns = await loadAllPatterns(repoName);
  await generateAllCommands(patterns, config, repoName);
}
