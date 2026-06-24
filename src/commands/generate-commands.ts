import { resolveRepo } from "../config/resolve-repo.ts";
import { loadAllPatterns } from "../config/load-pattern.ts";
import { generateAllCommands } from "../generator/generate-commands.ts";

export async function generateCommandsCommand(options: { cwd?: string }): Promise<void> {
  const config = await resolveRepo(options.cwd ?? process.cwd());
  const patterns = await loadAllPatterns(config.path);
  await generateAllCommands(patterns, config);
}
