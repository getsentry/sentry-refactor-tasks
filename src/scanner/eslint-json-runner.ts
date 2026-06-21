#!/usr/bin/env node --experimental-strip-types

import { execFileSync } from "node:child_process";
import fg from "fast-glob";

const repoPath = process.argv[2];
const rule = process.argv[3];
const scanPaths = process.argv.slice(4);

if (!repoPath || !rule || scanPaths.length === 0) {
  console.error("Usage: eslint-json-runner <repo-path> <rule-id> <path...>");
  process.exit(1);
}

const patterns = scanPaths.map((p) => (p.includes("*") ? p : `${p}/**/*.{ts,tsx}`));

const files = fg.sync(patterns, {
  cwd: repoPath,
  ignore: ["**/__fixtures__/**", "**/__mocks__/**", "**/*.spec.*", "**/*.test.*"],
  absolute: false,
});

if (files.length === 0) {
  console.log("[]");
  process.exit(0);
}

let rawOutput: string;
try {
  rawOutput = execFileSync(
    "npx",
    [
      "eslint",
      "--no-inline-config",
      "--rule",
      JSON.stringify({ [rule]: "error" }),
      "--format",
      "json",
      "--no-warn-ignored",
      ...files,
    ],
    {
      cwd: repoPath,
      maxBuffer: 100 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
} catch (err: any) {
  rawOutput = err.stdout ?? "";
}

if (!rawOutput) {
  console.log("[]");
  process.exit(0);
}

interface EslintResult {
  filePath: string;
  messages: Array<{
    ruleId: string;
    message: string;
    line: number;
    endLine?: number;
    column: number;
    endColumn?: number;
  }>;
}

const parsed: EslintResult[] = JSON.parse(rawOutput);
const withViolations = parsed
  .map((f) => ({
    filePath: f.filePath,
    messages: f.messages
      .filter((m) => m.ruleId === rule)
      .map((m) => ({
        ruleId: m.ruleId,
        message: m.message,
        line: m.line,
        endLine: m.endLine,
      })),
  }))
  .filter((f) => f.messages.length > 0);

console.log(JSON.stringify(withViolations));
