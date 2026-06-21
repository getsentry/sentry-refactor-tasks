import chalk from "chalk";
import type { ScanFinding } from "../scanner/result.ts";

const SEVERITY_ICONS: Record<string, string> = {
  error: chalk.red("ERR"),
  warning: chalk.yellow("WRN"),
  info: chalk.blue("INF"),
};

const CONFIDENCE_COLORS: Record<string, (s: string) => string> = {
  high: chalk.green,
  medium: chalk.yellow,
  low: chalk.dim,
};

export function printFindings(findings: ScanFinding[]): void {
  if (findings.length === 0) {
    console.error(chalk.green("No violations found."));
    return;
  }

  const grouped = Map.groupBy(findings, (f) => f.file);

  for (const [file, fileFindings] of grouped) {
    console.error(chalk.underline(file));
    for (const f of fileFindings) {
      const icon = SEVERITY_ICONS[f.severity] ?? "???";
      const conf = (CONFIDENCE_COLORS[f.confidence] ?? chalk.dim)(`[${f.confidence}]`);
      console.error(`  ${icon} L${f.line_start}-${f.line_end} ${conf} ${f.pattern_name}`);
      console.error(chalk.dim(`    ${f.explanation}`));
      if (f.snippet) {
        const lines = f.snippet.split("\n").slice(0, 3);
        for (const line of lines) {
          console.error(chalk.dim(`    > ${line}`));
        }
      }
    }
    console.error();
  }

  const errCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;
  const parts: string[] = [];
  if (errCount) parts.push(chalk.red(`${errCount} errors`));
  if (warnCount) parts.push(chalk.yellow(`${warnCount} warnings`));
  if (infoCount) parts.push(chalk.blue(`${infoCount} info`));
  console.error(`Found ${findings.length} violations: ${parts.join(", ")}`);
}
