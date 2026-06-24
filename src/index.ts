#!/usr/bin/env node
import { Command } from "commander";
import { setVerbose, error } from "./utils/logger.ts";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

const CWD_OPTION = ["-C, --cwd <dir>", "repo directory to operate on (defaults to cwd)"] as const;

program
  .name("refactor-tasks")
  .description("LLM-powered code convention scanner that reports refactor tasks to Sentry")
  .version(pkg.version);

program
  .command("list")
  .description("List the conventions configured for the repo")
  .option(...CWD_OPTION)
  .action(async (opts: { cwd?: string }) => {
    const { listCommand } = await import("./commands/list.ts");
    await listCommand(opts);
  });

program
  .command("validate")
  .description("Validate the repo's repo.yaml and convention definitions")
  .option(...CWD_OPTION)
  .action(async (opts: { cwd?: string }) => {
    const { validateCommand } = await import("./commands/validate.ts");
    await validateCommand(opts);
  });

program
  .command("generate-commands")
  .description("Use LLM to generate prefilter shell commands")
  .option(...CWD_OPTION)
  .action(async (opts: { cwd?: string }) => {
    const { generateCommandsCommand } = await import("./commands/generate-commands.ts");
    await generateCommandsCommand(opts);
  });

program
  .command("scan")
  .description("Run conventions against the repo")
  .argument("[pattern]", "specific convention name (or all)")
  .option("-m, --model <model>", "model override (haiku/sonnet/opus)")
  .option("--dry-run", "show candidate files without scanning")
  .option(...CWD_OPTION)
  .option("-v, --verbose", "verbose output")
  .action(
    async (
      pattern: string | undefined,
      opts: { model?: string; dryRun?: boolean; cwd?: string; verbose?: boolean },
    ) => {
      if (opts.verbose) setVerbose(true);
      const { scanCommand } = await import("./commands/scan.ts");
      await scanCommand(pattern, opts);
    },
  );

program
  .command("report")
  .description("Send scan results to Sentry")
  .argument("<results-file>", "path to scan results JSON")
  .requiredOption("--dsn <dsn>", "Sentry DSN")
  .action(async (resultsFile: string, opts: { dsn: string }) => {
    const { reportCommand } = await import("./commands/report.ts");
    await reportCommand(resultsFile, opts.dsn);
  });

program
  .command("scan-and-report")
  .description("Scan and report to Sentry in one step")
  .option("-m, --model <model>", "model override (haiku/sonnet/opus)")
  .option("-p, --pattern <pattern>", "specific convention name")
  .option(...CWD_OPTION)
  .option("-v, --verbose", "verbose output")
  .action(async (opts: { model?: string; pattern?: string; cwd?: string; verbose?: boolean }) => {
    if (opts.verbose) setVerbose(true);
    const { scanAndReportCommand } = await import("./commands/scan-and-report.ts");
    await scanAndReportCommand({
      model: opts.model,
      patternFilter: opts.pattern,
      cwd: opts.cwd,
    });
  });

program.parseAsync().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
