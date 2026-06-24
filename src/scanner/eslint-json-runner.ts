#!/usr/bin/env node --experimental-strip-types

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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

// Run eslint with a standalone flat config that loads only this rule's plugin
// and enables only this rule. The target repo's own eslint.config may be
// written for a different version of the plugin (different rule names), so we
// deliberately bypass it with --no-config-lookup. The config lives inside the
// repo so its imports resolve from the repo's node_modules, where the pinned
// plugin version (installed by the convention's detect_command) lives.
//
// Inline eslint-disable directives are still honored (no --no-inline-config),
// so findings match what the repo's own lint run would report.
const namespace = rule.split("/")[0];
const pluginPackage = `eslint-plugin-${namespace}`;
const configPath = join(repoPath, `.eslint-${namespace}.config.mjs`);

writeFileSync(
  configPath,
  `import parser from '@typescript-eslint/parser';
import plugin from '${pluginPackage}';
export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' } },
    plugins: { '${namespace}': plugin },
    rules: { '${rule}': 'error' },
  },
];
`,
);

let rawOutput: string;
try {
  rawOutput = execFileSync(
    "npx",
    [
      "eslint",
      "--config",
      configPath,
      "--no-config-lookup",
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
} finally {
  rmSync(configPath, { force: true });
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
