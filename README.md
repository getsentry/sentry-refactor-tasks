# Convention scanner (CLI)

An LLM-powered scanner that finds code-convention violations in a target repo
and reports each one to Sentry, where [Seer](https://docs.sentry.io/product/ai-in-sentry/seer/)
can pick them up and open fix PRs. Conventions are plain YAML files, so adding a
new rule needs no code changes.

See [docs/data-flow.md](docs/data-flow.md) for an end-to-end diagram
(convention → issue → Seer PR).

## Prerequisites

- Node v24+ (the CLI runs TypeScript directly via `--experimental-strip-types`)
- [pnpm](https://pnpm.io/) (`packageManager` is pinned in `package.json`)
- The [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI, installed
  and authenticated — the LLM detection path shells out to `claude --print`
- Git access (SSH or HTTPS) to each target repo's `git_url` — the CLI clones it
  itself into `checkouts/<name>/` and updates it to the latest revision per run

## Install

```bash
pnpm install
```

All commands run through the entrypoint:

```bash
node --experimental-strip-types src/index.ts <command> [args]
# or: pnpm start <command> [args]
```

## Commands

| Command | Description |
|---------|-------------|
| `list [repo]` | List configured repos, or the conventions for one repo |
| `validate [repo]` | Validate `repo.yaml` and all convention files against the schema |
| `scan <repo> [pattern]` | Run conventions against a repo and print findings |
| `scan-and-report <repo>` | Scan and send findings to Sentry in one step |
| `report <results-file> --dsn <dsn>` | Send a saved findings JSON to Sentry |
| `generate-commands <repo>` | Use the LLM to generate prefilter shell commands |

Common options:

- `-m, --model <haiku\|sonnet\|opus>` — override the repo's `default_model`
- `--dry-run` — (scan) list candidate files without calling the LLM
- `-p, --pattern <name>` — (scan-and-report) limit to one convention
- `-v, --verbose` — verbose logging

## Examples

```bash
# See what's configured
node --experimental-strip-types src/index.ts list
node --experimental-strip-types src/index.ts list sentry

# Validate configs before scanning
node --experimental-strip-types src/index.ts validate sentry

# Preview candidate files for one convention (no LLM cost)
node --experimental-strip-types src/index.ts scan sentry no-class-components --dry-run

# Scan a single convention and report results to Sentry
node --experimental-strip-types src/index.ts scan-and-report sentry -p no-class-components -v
```

## Configuring a target repo

Each repo lives under `repos/<name>/` with a `repo.yaml`:

```yaml
repo: getsentry/sentry                    # GitHub owner/name (used for permalinks)
git_url: git@github.com:getsentry/sentry.git  # cloned into checkouts/<name>/
sentry_dsn: https://...                   # DSN findings are reported to
default_model: haiku                      # haiku | sonnet | opus
scan_concurrency: 4                       # parallel LLM batches
```

The CLI clones `git_url` into `checkouts/<name>/` on first run, and on every
later run fetches and hard-resets it to the latest revision before scanning.

## Writing a convention

Conventions are YAML files in `repos/<name>/conventions/*.yaml`. Each is
validated against the schema in `src/config/schemas.ts`:

```yaml
name: no-class-components       # kebab-case, unique
severity: warning               # error | warning | info
tags: [react, migration, hooks]
why: |                          # shown in the Sentry issue ("Why this matters")
  ...
detect: |                       # instructions the LLM uses to flag violations
  ...
fix: |                          # remediation guidance (Seer reads this)
  ...
examples:                       # optional, sharpens LLM precision
  bad: ["class Foo extends Component {}"]
  good: ["function Foo() {}"]
# --- choose ONE detection path ---
# LLM path: narrow candidates, then let the model judge them
include: ["static/app/**/*.tsx"]
exclude: ["**/*.test.*"]
prefilter: "grep -rl -E 'extends (React\\.)?(Pure)?Component' {repo_path}/static/app/"
# Lint path (bypasses the LLM): exact, fast, deterministic
# detect_command: "node ... eslint-json-runner.ts {repo_path} <rule> static/app"
```

Two detection paths:

- **LLM path** — `prefilter` (a shell command, `{repo_path}` is substituted) or
  `include`/`exclude` globs narrow the file set, then Claude judges each file
  against `detect`/`examples`. Results are cached by file content hash.
- **Lint path** — set `detect_command` to run a tool (e.g. ESLint) directly. No
  LLM is called and line numbers come straight from the tool.
