#!/usr/bin/env node
import { Command } from "commander";
import { setVerbose } from "./utils/logger.ts";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("refactor-tasks")
  .description("LLM-powered code convention scanner that reports refactor tasks to Sentry")
  .version(pkg.version);

program
  .command("list")
  .description("List configured repos, or patterns for a repo")
  .argument("[repo]", "repo name to list patterns for")
  .action(async (repo?: string) => {
    const { listCommand } = await import("./commands/list.ts");
    await listCommand(repo);
  });

program
  .command("validate")
  .description("Validate YAML configs and pattern definitions")
  .argument("[repo]", "repo name to validate (or all)")
  .action(async (repo?: string) => {
    const { validateCommand } = await import("./commands/validate.ts");
    await validateCommand(repo);
  });

program
  .command("generate-commands")
  .description("Use LLM to generate prefilter shell commands")
  .argument("<repo>", "repo name")
  .action(async (repo: string) => {
    const { generateCommandsCommand } = await import("./commands/generate-commands.ts");
    await generateCommandsCommand(repo);
  });

program
  .command("scan")
  .description("Run patterns against a repo")
  .argument("<repo>", "repo name")
  .argument("[pattern]", "specific pattern name (or all)")
  .option("-m, --model <model>", "model override (haiku/sonnet/opus)")
  .option("--dry-run", "show candidate files without scanning")
  .option("-v, --verbose", "verbose output")
  .action(
    async (
      repo: string,
      pattern: string | undefined,
      opts: { model?: string; dryRun?: boolean; verbose?: boolean },
    ) => {
      if (opts.verbose) setVerbose(true);
      const { scanCommand } = await import("./commands/scan.ts");
      await scanCommand(repo, pattern, opts);
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
  .argument("<repo>", "repo name")
  .option("-m, --model <model>", "model override (haiku/sonnet/opus)")
  .option("-p, --pattern <pattern>", "specific pattern name")
  .option("-v, --verbose", "verbose output")
  .action(async (repo: string, opts: { model?: string; pattern?: string; verbose?: boolean }) => {
    if (opts.verbose) setVerbose(true);
    const { scanAndReportCommand } = await import("./commands/scan-and-report.ts");
    await scanAndReportCommand(repo, {
      model: opts.model,
      patternFilter: opts.pattern,
    });
  });

program.parse();
