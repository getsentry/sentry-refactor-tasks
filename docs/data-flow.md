# Data flow: convention → Sentry issue → Seer PR

How a convention definition becomes a flagged violation, a Sentry issue, and
ultimately an automated fix PR.

```mermaid
flowchart TD
    subgraph authoring["1. Authoring"]
        YAML["Convention YAML<br/>repos/&lt;repo&gt;/conventions/*.yaml<br/>(why, detect, fix, examples,<br/>prefilter / detect_command)"]
        VALIDATE["loadPattern → PatternSchema (Zod)<br/>validate command"]
        YAML --> VALIDATE
    end

    VALIDATE --> SCAN

    subgraph scanning["2. Scanning (scanRepo → scanPattern)"]
        SCAN{"detect_command<br/>set?"}

        %% lint path (no LLM)
        SCAN -->|yes| DETECT["runDetectCommand<br/>e.g. eslint-json-runner<br/>(no LLM, exact line numbers)"]

        %% LLM path
        SCAN -->|no| PREFILTER["getFilesToScan<br/>prefilter grep OR include/exclude globs<br/>→ candidate files"]
        PREFILTER --> CACHE1["ScanCache lookup by content hash"]
        CACHE1 -->|cached| RAW
        CACHE1 -->|uncached| BATCH["batchFiles<br/>(≤20 files / ≤80k tokens)"]
        BATCH --> CLAUDE["analyzeWithClaude<br/>claude --print + system prompt<br/>+ findings JSON schema"]
        CLAUDE --> CORRECT["correctLineNumbers<br/>(match snippet to source)"]
        CORRECT --> CACHE2["cache.store(hash → findings)"]
        CACHE2 --> RAW

        DETECT --> RAW["RawFinding[]<br/>file, lines, snippet,<br/>confidence, explanation"]
    end

    RAW --> HYDRATE["hydrateFinding<br/>RawFinding + pattern (why/fix/<br/>severity/tags) + repo + git_sha"]
    HYDRATE --> DEDUP["deduplicateFindings<br/>key = pattern:file:line"]
    DEDUP --> REPORT

    subgraph reporting["3. Reporting (reportFindings)"]
        REPORT["Sentry SDK: per finding<br/>withScope → captureMessage"]
        REPORT --> SCOPE["fingerprint [pattern, file, line]<br/>tags: violation_type, severity,<br/>confidence, repo, git_sha, url<br/>context: violation<br/>message: code + problem +<br/>why + how-to-fix + GitHub permalink"]
    end

    SCOPE --> SENTRY

    subgraph sentry["4. Sentry"]
        SENTRY["Sentry ingest"]
        SENTRY --> ISSUE["Issue<br/>grouped by fingerprint<br/>(one per pattern+file+line)"]
    end

    ISSUE --> SEER

    subgraph seer["5. Seer (Sentry AI agent)"]
        SEER["Reads issue: problem +<br/>how-to-fix guidance + GitHub URL"]
        SEER --> PR["Generates fix, opens<br/>Pull Request on GitHub"]
    end

    PR --> MERGE["Review & merge"]
    MERGE -.->|"new git_sha;<br/>violation no longer flagged"| SCAN
```

## Notes

- **Two detection paths.** A convention either bypasses the LLM via
  `detect_command` (e.g. an ESLint rule — fast, exact line numbers) or uses the
  LLM path: a `prefilter` grep (or `include`/`exclude` globs) narrows candidate
  files, then `analyzeWithClaude` judges each batch against the convention's
  `detect`/`examples`. `no-class-components` uses the LLM path with a grep
  prefilter for `extends (React.)?(Pure)?Component`.
- **Caching.** Findings are cached by file content hash, so re-scans only call
  the LLM on changed files.
- **Hydration** merges the per-file `RawFinding` (from LLM or lint tool) with the
  static convention metadata (`why`, `fix`, `severity`, `tags`) plus `repo` and
  `git_sha`, producing the `ScanFinding` that gets reported.
- **Fingerprinting** (`pattern:file:line`) controls Sentry grouping: each
  distinct violation site becomes its own issue, and re-reporting the same site
  reopens/updates rather than duplicates.
- **Seer** is a Sentry product feature, not part of this repo. It consumes the
  issue — the "How to fix" section and the GitHub permalink give it the context
  to generate a fix and open a PR.
