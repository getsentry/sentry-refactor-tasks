import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
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

export async function execShellPermissive(
  command: string,
  options?: ExecOptions,
): Promise<ExecResult> {
  try {
    return await exec("/bin/sh", ["-c", command], options);
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}
