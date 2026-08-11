import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface PermissiveExecResult extends ExecResult {
  /** Exit code; a string like "ENOENT" if the process never spawned; null if killed by a signal. */
  code: number | string | null;
  /** Signal that killed the process, if any (e.g. "SIGTERM" on the exec timeout). */
  signal: NodeJS.Signals | null;
}

export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  /** Extra variables layered on top of the current environment. */
  env?: Record<string, string>;
}

export async function exec(
  command: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: options?.timeout ?? 30_000,
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : undefined,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function execShell(command: string, options?: ExecOptions): Promise<ExecResult> {
  return exec("/bin/sh", ["-c", command], options);
}

// Unlike exec(), never throws: the caller needs stdout/stderr/exit status for a
// process that may legitimately fail (a detect command reporting no findings
// looks the same as one that crashed, unless the caller inspects all three).
export async function execShellPermissive(
  command: string,
  options?: ExecOptions,
): Promise<PermissiveExecResult> {
  try {
    const { stdout, stderr } = await exec("/bin/sh", ["-c", command], options);
    return { stdout, stderr, code: 0, signal: null };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? null,
      signal: err.signal ?? null,
    };
  }
}
