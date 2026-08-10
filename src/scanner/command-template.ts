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

const TOKEN_PATTERN = /\{(?:repo_path|convention_dir)\}/g;

/**
 * A token expands to `"$VAR"`, which only stays a single argument when it sits
 * outside quotes. An author-quoted token would nest that expansion inside
 * another quoted string — `"{repo_path}/src"` becomes `""$VAR"/src"`, where the
 * shell word-splits the value again, reintroducing the bug this module exists
 * to prevent. Refuse the template instead of running something subtly wrong.
 */
function assertTokensUnquoted(template: string): void {
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const before = template[match.index - 1];
    const after = template[match.index + match[0].length];
    if (before === '"' || before === "'" || after === '"' || after === "'") {
      throw new Error(
        `Pattern command quotes the ${match[0]} token, which breaks argument splitting.\n` +
          `Write it bare — e.g. ${match[0]}/static/app, not "${match[0]}/static/app" — ` +
          `it already expands to a quoted value.\n` +
          `  Command: ${template}`,
      );
    }
  }
}

/**
 * Expand the `{repo_path}` / `{convention_dir}` tokens a pattern's shell
 * command may use. Each token becomes a double-quoted reference to a variable
 * carrying the real path, so it stays a single argument no matter what the
 * path contains.
 */
export function prepareCommand(template: string, repoPath: string): PreparedCommand {
  assertTokensUnquoted(template);

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

/** Characters that need no quoting to survive the shell untouched. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote a value the way a shell would need it written to mean exactly itself. */
function shellQuote(value: string): string {
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Render a prepared command with its variables resolved, for verbose logs.
 * The values are shell-quoted so the logged line stays a faithful — and
 * runnable — depiction of what executed; substituting them bare would print a
 * path with spaces as several arguments, which is not what ran. This string is
 * only ever displayed, never executed.
 */
export function describeCommand({ command, env }: PreparedCommand): string {
  return Object.entries(env).reduce(
    (text, [name, value]) => text.replaceAll(`"$${name}"`, shellQuote(value)),
    command,
  );
}
