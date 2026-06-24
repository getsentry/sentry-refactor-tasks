# Convention scanner (CLI)

An LLM-powered scanner that finds code-convention violations in a target repo
and reports each one to Sentry, where [Seer](https://docs.sentry.io/product/ai-in-sentry/seer/)
can pick them up and open fix PRs. Conventions are plain YAML files, so adding a
new rule needs no code changes.

Each repo defines its own conventions in a `.sentry-refactor-tasks/` directory
at its root. You run the CLI from inside that repo; it discovers the folder and
scans the working tree in place. No conventions ship with this package.

See [docs/data-flow.md](docs/data-flow.md) for an end-to-end diagram
(convention → issue → Seer PR).

## Prerequisites

- Node v24+ (the CLI runs TypeScript directly — Node strips types natively)
- [pnpm](https://pnpm.io/) (`packageManager` is pinned in `package.json`)
- The [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI, installed
  and authenticated — the LLM detection path shells out to `claude --print`
- A checkout of the repo you want to scan, with a `.sentry-refactor-tasks/`
  config folder at its root (see [Configuring a target repo](#configuring-a-target-repo)).
  The scanner reads the working tree as-is — it does not clone or update it.

## Install

Published to npm as [`@sentry/refactor-tasks`](https://www.npmjs.com/package/@sentry/refactor-tasks).
Run it without installing:

```bash
npx @sentry/refactor-tasks <command> [args]
```

Or install the `refactor-tasks` CLI globally:

```bash
npm install -g @sentry/refactor-tasks
refactor-tasks <command> [args]
```

### From a clone (for development)

```bash
pnpm install
pnpm start <command> [args]   # alias for: node src/index.ts
```

## Commands

All commands operate on the repo discovered from the current directory (walking
up to find a `.sentry-refactor-tasks/` folder).

| Command                             | Description                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| `list`                              | List the conventions configured for the repo                 |
| `validate`                          | Validate `repo.yaml` and all convention files against schema |
| `scan [pattern]`                    | Run conventions against the repo and print findings          |
| `scan-and-report`                   | Scan and send findings to Sentry in one step                 |
| `report <results-file> --dsn <dsn>` | Send a saved findings JSON to Sentry                         |
| `generate-commands`                 | Use the LLM to generate prefilter shell commands             |

Common options:

- `-C, --cwd <dir>` — operate on the repo at `<dir>` instead of the current directory
- `-m, --model <haiku\|sonnet\|opus>` — override the repo's `default_model`
- `--dry-run` — (scan) list candidate files without calling the LLM
- `-p, --pattern <name>` — (scan-and-report) limit to one convention
- `-v, --verbose` — verbose logging

## Examples

```bash
# Run from inside the repo you want to scan
cd ~/code/sentry

# See what's configured
refactor-tasks list

# Validate configs before scanning
refactor-tasks validate

# Preview candidate files for one convention (no LLM cost)
refactor-tasks scan no-class-components --dry-run

# Scan a single convention and report results to Sentry
refactor-tasks scan-and-report -p no-class-components -v

# Or point at a repo without cd-ing into it
refactor-tasks list --cwd ~/code/sentry
```

(From a clone of this tool, swap `refactor-tasks` for `pnpm start`.)

## Configuring a target repo

A repo opts in by adding a `.sentry-refactor-tasks/` directory at its root:

```
my-repo/
  .sentry-refactor-tasks/
    repo.yaml
    conventions/
      no-derived-state.yaml
      ...
```

`repo.yaml` holds repo-level settings:

```yaml
sentry_dsn: https://... # DSN findings are reported to
default_model: haiku # haiku | sonnet | opus
scan_concurrency: 4 # parallel LLM batches
```

The CLI walks up from the current directory to find `.sentry-refactor-tasks/`,
then scans that repo's working tree in place — it never clones or mutates it.
The `owner/name` slug used for issue permalinks is read from the checkout's git
`origin` remote, so it isn't configured here.

## Writing a convention

Conventions are YAML files in `.sentry-refactor-tasks/conventions/*.yaml`. Each
is validated against the schema in `src/config/schemas.ts`:

```yaml
name: no-class-components # kebab-case, unique
severity: warning # error | warning | info
tags: [react, migration, hooks]
why: | # shown in the Sentry issue ("Why this matters")
  ...
detect: | # instructions the LLM uses to flag violations
  ...
fix: | # remediation guidance (Seer reads this)
  ...
examples: # optional, sharpens LLM precision
  bad: ["class Foo extends Component {}"]
  good: ["function Foo() {}"]
# --- choose ONE detection path ---
# LLM path: narrow candidates, then let the model judge them
include: ["static/app/**/*.tsx"]
exclude: ["**/*.test.*"]
prefilter: "grep -rl -E 'extends (React\\.)?(Pure)?Component' {repo_path}/static/app/"
# Lint path (bypasses the LLM): exact, fast, deterministic
# detect_command: "bash {convention_dir}/no-derived-state.detect.sh {repo_path}"
```

Two detection paths:

- **LLM path** — `prefilter` (a shell command) or `include`/`exclude` globs
  narrow the file set, then Claude judges each file against `detect`/`examples`.
  Results are cached by file content hash.
- **Lint path** — set `detect_command` to run a tool (e.g. ESLint) directly. No
  LLM is called and line numbers come straight from the tool.

In both shell commands these tokens are substituted: `{repo_path}` (the repo
root being scanned) and `{convention_dir}` (the repo's
`.sentry-refactor-tasks/conventions/` folder — use it to reference sidecar
scripts/configs that live next to the YAML).

### Detection output (stdout shape)

The two paths read different things from the command's **stdout**. In both
cases, write any install/progress noise to **stderr** (e.g. `pnpm install …
1>&2`) so it doesn't corrupt stdout.

**`prefilter` → a newline-separated list of absolute file paths.** Each line is
one candidate file the LLM will then judge. Blank lines are ignored; no output
(or a non-zero exit) means "no candidates". This is exactly what
`grep -rl … {repo_path}/static/app/` prints:

```text
/abs/checkout/static/app/views/foo.tsx
/abs/checkout/static/app/components/bar.tsx
```

**`detect_command` → a JSON array of per-file results.** The LLM is skipped
entirely. The scanner turns _every_ message into a finding (so emit only the
messages you want reported), taking the line numbers and `message` text
straight from the tool:

```json
[
  {
    "filePath": "/abs/checkout/static/app/views/foo.tsx",
    "messages": [
      {
        "ruleId": "react-you-might-not-need-an-effect/no-derived-state",
        "message": "Avoid storing derived state. Instead, compute \"x\" during render",
        "line": 104,
        "endLine": 104
      }
    ]
  }
]
```

Per file: `filePath` is absolute; files with an empty `messages` array are
ignored. Per message: `line` and `message` are required (`message` becomes the
finding's explanation), `endLine` is optional (defaults to `line`), and
`ruleId` is optional/informational. Print `[]` when there are no violations.

A worked example lives in the sentry repo at
`.sentry-refactor-tasks/conventions/no-derived-state.detect.sh`: it snapshots and
restores `package.json`/`pnpm-lock.yaml`, installs its pinned eslint plugin,
writes a standalone eslint config, and runs the `eslint-json-runner.ts` beside it
to emit this JSON — keeping the scanned working tree clean.
