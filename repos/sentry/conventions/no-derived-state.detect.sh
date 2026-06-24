#!/usr/bin/env bash
#
# Detector for the `no-derived-state` convention.
#
# This is where everything specific to the sentry repo and the
# eslint-plugin-react-you-might-not-need-an-effect plugin lives. The generic
# eslint-json-runner.ts sits alongside this script (so eslint stays out of the
# core scanner) and is located relative to this file.
#
# Usage: no-derived-state.detect.sh <repo-path>
#   <repo-path>  checkout of the target repo (cwd for pnpm/eslint)
#
# All install/diagnostic output goes to stderr; only the runner's JSON reaches
# stdout, which the scanner parses.
set -euo pipefail

repo_path="$1"
script_dir="$(cd "$(dirname "$0")" && pwd)"
rule="react-you-might-not-need-an-effect/no-derived-state"
config_path="$repo_path/.no-derived-state.eslint.config.mjs"

cd "$repo_path"

# Bring up the repo's toolchain, then pin the plugin to the version this
# convention's detection depends on — independent of the repo's own lockfile.
pnpm install --frozen-lockfile 1>&2
pnpm add -D eslint-plugin-react-you-might-not-need-an-effect@1.0.1 1>&2

# Write a standalone flat config that loads only this rule. Bypassing the
# repo's own eslint.config avoids failures from rule names that differ between
# plugin versions. It lives inside the repo so its imports resolve from the
# repo's node_modules (where the pinned plugin version is installed). Removed
# on exit so the checkout is left clean.
trap 'rm -f "$config_path"' EXIT
cat > "$config_path" <<'EOF'
import parser from '@typescript-eslint/parser';
import plugin from 'eslint-plugin-react-you-might-not-need-an-effect';
export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' } },
    plugins: { 'react-you-might-not-need-an-effect': plugin },
    rules: { 'react-you-might-not-need-an-effect/no-derived-state': 'error' },
  },
];
EOF

pnpm exec node "$script_dir/eslint-json-runner.ts" "$repo_path" "$rule" "$config_path" static/app
