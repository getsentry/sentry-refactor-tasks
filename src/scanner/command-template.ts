import { conventionsDir } from "../config/paths.ts";

/**
 * Shell variables the path tokens expand to. Pattern commands run through
 * `/bin/sh -c`, so the paths are passed in the child's environment and the
 * command text only ever references them by name: a checkout whose path
 * contains spaces, quotes, or `$(...)` can't reshape the command.
 */
const REPO_PATH_VAR = "REFACTOR_TASKS_REPO_PATH";
const CONVENTION_DIR_VAR = "REFACTOR_TASKS_CONVENTION_DIR";

export interface PreparedCommand {
  /** Command text to hand to the shell, with tokens replaced by `"$VAR"`. */
  command: string;
  /** Values the referenced variables are bound to. */
  env: Record<string, string>;
}

/**
 * Expand the `{repo_path}` / `{convention_dir}` tokens a pattern's shell
 * command may use. Each token becomes a double-quoted reference to a variable
 * carrying the real path, so it stays a single argument no matter what the
 * path contains.
 */
export function prepareCommand(template: string, repoPath: string): PreparedCommand {
  const command = template
    .replace(/\{repo_path\}/g, `"$${REPO_PATH_VAR}"`)
    .replace(/\{convention_dir\}/g, `"$${CONVENTION_DIR_VAR}"`);

  return {
    command,
    env: {
      [REPO_PATH_VAR]: repoPath,
      [CONVENTION_DIR_VAR]: conventionsDir(repoPath),
    },
  };
}

/** Render a prepared command with its variables resolved, for verbose logs. */
export function describeCommand({ command, env }: PreparedCommand): string {
  return Object.entries(env).reduce(
    (text, [name, value]) => text.replaceAll(`"$${name}"`, value),
    command,
  );
}
