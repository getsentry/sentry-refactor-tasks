import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function exec(
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: options?.timeout ?? 30_000,
    cwd: options?.cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function execShell(
  command: string,
  options?: { timeout?: number; cwd?: string },
): Promise<ExecResult> {
  return exec("/bin/sh", ["-c", command], options);
}

export async function execShellPermissive(
  command: string,
  options?: { timeout?: number; cwd?: string },
): Promise<ExecResult> {
  try {
    return await exec("/bin/sh", ["-c", command], {
      timeout: options?.timeout ?? 30_000,
      cwd: options?.cwd,
    });
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}
