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
- An inference backend for the LLM detection path (see
  [Inference backends](#inference-backends)) — either an OpenRouter API key or
  the local [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI,
  installed and authenticated
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

| Command                 | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `list`                  | List the conventions configured for the repo        |
| `validate`              | Validate all convention files against schema        |
| `scan [pattern]`        | Run conventions against the repo and print findings |
| `scan-and-report`       | Scan and send findings to Sentry in one step        |
| `report <results-file>` | Send a saved findings JSON to Sentry                |
| `generate-commands`     | Use the LLM to generate prefilter shell commands    |

Common options:

- `-C, --cwd <dir>` — operate on the repo at `<dir>` instead of the current directory
- `-m, --model <haiku\|sonnet\|opus>` — override `INFERENCE_MODEL`
- `--dry-run` — (scan) list candidate files without calling the LLM
- `-p, --pattern <name>` — (scan-and-report) limit to one convention
- `--dsn <dsn>` — (scan-and-report, report) Sentry DSN; defaults to `SENTRY_DSN`
- `--chunk-size <n>` — (report) findings per Sentry batch; `0` (default) sends
  all at once, a positive value throttles into chunks of that size (see
  [Spike protection](#spike-protection--chunked-reporting))
- `-v, --verbose` — verbose logging

## Cache location

Scan results (keyed by file content hash) and generated prefilter commands are
cached on disk at a stable, user-level path so they persist across runs —
including `npx`, whose package install is ephemeral:

```
$XDG_CACHE_HOME/sentry-refactor-tasks/    # if XDG_CACHE_HOME is set
~/.cache/sentry-refactor-tasks/           # otherwise
```

Entries are namespaced per repo (`<owner>-<repo>/`). To force a clean re-scan,
delete that directory.

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
    conventions/
      no-derived-state.yaml
      ...
```

The folder only needs a `conventions/` directory. Repo-level settings come
from the environment (or CLI flags):

| Variable                           | Purpose                                                                                                          | Default                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `SENTRY_DSN`                       | DSN findings are reported to (or pass `--dsn`).                                                                  | _(required to report)_ |
| `INFERENCE_MODEL`                  | Model tier: `haiku` \| `sonnet` \| `opus`.                                                                       | `haiku`                |
| `SCAN_CONCURRENCY`                 | Parallel LLM batches.                                                                                            | `4`                    |
| `REFACTOR_TASKS_SENTRY_CHUNK_SIZE` | Findings per Sentry batch; `0` sends all at once (see [Spike protection](#spike-protection--chunked-reporting)). | `0`                    |

A DSN is only needed when reporting — `list`, `validate`, and `scan` run
without one. `scan-and-report` and `report` require `--dsn` or `SENTRY_DSN` and
error clearly if neither is set.

The CLI walks up from the current directory to find `.sentry-refactor-tasks/`,
then scans that repo's working tree in place — it never clones or mutates it.
The `owner/name` slug used for issue permalinks is read from the checkout's git
`origin` remote, so it isn't configured here.

## Inference backends

The LLM detection path can run against either backend. Selection is driven by
environment variables — no secrets live in config files or on the command line,
so API keys don't leak into config files or shell history.

- **OpenRouter** ([openrouter.ai](https://openrouter.ai)) — set
  `OPENROUTER_API_KEY` and requests go over HTTPS to OpenRouter's
  OpenAI-compatible API. This is used automatically whenever the key is present.
- **Local `claude` CLI** — used when no OpenRouter key is set. Shells out to
  `claude --print`; relies on the binary's own authentication.

To force a backend regardless of what's set, use `INFERENCE_PROVIDER`.

| Variable                  | Purpose                                                          | Default                        |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `OPENROUTER_API_KEY`      | OpenRouter API key. Its presence enables the OpenRouter backend. | _(unset → use `claude` CLI)_   |
| `INFERENCE_PROVIDER`      | Force a backend: `openrouter` or `claude-cli`.                   | auto-detect from the key       |
| `OPENROUTER_BASE_URL`     | Override the OpenRouter API base URL.                            | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL_HAIKU`  | OpenRouter model ID the `haiku` tier maps to.                    | `anthropic/claude-3.5-haiku`   |
| `OPENROUTER_MODEL_SONNET` | OpenRouter model ID the `sonnet` tier maps to.                   | `anthropic/claude-sonnet-4`    |
| `OPENROUTER_MODEL_OPUS`   | OpenRouter model ID the `opus` tier maps to.                     | `anthropic/claude-opus-4`      |

The `INFERENCE_MODEL` env var and `-m/--model` flag still take a tier
(`haiku`/`sonnet`/`opus`); for OpenRouter each tier is mapped to a model ID via
the table above. You can also pass a fully qualified OpenRouter model ID (e.g.
`-m anthropic/claude-opus-4`) to bypass the mapping.

```bash
# Use OpenRouter (key sourced from the environment, never persisted)
export OPENROUTER_API_KEY=sk-or-...
refactor-tasks scan
```

### Spike protection & chunked reporting

A scan can surface thousands of findings, each reported as a separate Sentry
event. [Spike protection](https://docs.sentry.io/pricing/quotas/spike-protection/)
guards a project against sudden bursts of ingest — but that's exactly what a
large scan looks like, so with it **enabled**, Sentry rate-limits the burst and
**silently drops most events**: you'll see only a fraction of the expected
issues created.

The `REFACTOR_TASKS_SENTRY_CHUNK_SIZE` env var controls this:

- A positive value sends findings in throttled chunks of that size, flushing
  after each, so a large scan stays under the spike-protection rate limit and
  every finding lands. Start around `25` if you hit drops.
- `0` sends every finding in one batch. Fast, but only safe when the project has
  spike protection **disabled**.
- Leaving it unset defaults to `0`, so the effective default is a single batch
  unless you opt into chunking via the env var or the flag below.

During `scan-and-report`, findings **stream** to Sentry as each convention
finishes scanning — a chunk is sent as soon as enough accumulate (counting
across conventions), so reporting overlaps with the rest of the scan rather than
waiting for it to finish. The `report` command takes the same control as a
`--chunk-size <n>` flag.

Check or change spike protection for your project under **Settings → Projects →
[your project] → Spike Protection** (URL:
`https://<your-org>.sentry.io/settings/projects/<your-project>/spike-protection/`).

When chunking (chunk size `> 0`), the pacing is tunable via env vars for
projects that need a gentler cadence: `REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS`
(default 1000) and `REFACTOR_TASKS_SENTRY_FLUSH_TIMEOUT_MS` (default 30000).

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
  Results are cached by file content hash (see [Cache location](#cache-location)).
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
