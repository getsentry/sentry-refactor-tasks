import { readFile } from "node:fs/promises";
import type { ScanFinding } from "../scanner/result.ts";
import { reportFindings } from "../reporter/sentry.ts";
import { error } from "../utils/logger.ts";

export async function reportCommand(resultsFile: string, dsn: string): Promise<void> {
  let findings: ScanFinding[];
  try {
    const raw = await readFile(resultsFile, "utf-8");
    findings = JSON.parse(raw) as ScanFinding[];
  } catch (e) {
    error(`Failed to read results file: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  if (findings.length === 0) {
    console.error("No findings to report.");
    return;
  }

  await reportFindings(findings, dsn);
}
