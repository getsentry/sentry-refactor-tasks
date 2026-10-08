# LLM scan benchmark

Measures cost, latency, recall and precision of the LLM scan path (conventions
without a `detect_command`) across models, batch sizes, prompt shapes and the
OpenRouter Batch API.

- `run.ts` drives the real prefilter, prompt, JSON schema and `locateFinding`
  code. Only batching and transport differ: `fetch` is wrapped to record
  OpenRouter usage per request, or to send every request through the Batch API.
- `judge.ts` builds ground truth. A strong model (Opus 5.5) judges every
  prefilter anchor line (each `@deprecated`, `api.request(`, ...) and every
  finding that is not near an anchor. Verdicts are cached in
  `results/judgements.json`. Recall is computed against that full set, not only
  against the union of what the runs found.
- `grid.sh`, `grid2.sh`, `final.sh` are the configurations that were run.

Point `--repo` / `REPO` at a frozen copy of the target repo
(`git archive <sha> static .sentry-refactor-tasks | tar -x -C <dir>`). A live
checkout can move while a long grid runs, and then the runs and the ground truth
are about different files.

## Results: getsentry/sentry @ 6bd6acb8f95, 2026-10-08

4 LLM conventions, 475 candidate files, ~2.0M prompt tokens per full scan.
Ground truth: 192 violations (deprecated-needs-replacement 9,
no-callback-api-request 3, no-class-components 32, no-custom-render-helper 148)
out of 657 judged sites.

Config names: `h55` Haiku 5.5, `h45` Haiku 4.5, `s55` Sonnet 5.5;
`fN` = max files per request; `t50k` = 50k estimated-token cap (default 80k);
`exN` = send only ±N lines around each anchor match; `verbatim` = prompt asks
for snippets copied verbatim; `none`/`high` = reasoning effort; `batchapi` =
OpenRouter Batch API. "Lenient recall" also counts findings the scanner dropped
as unlocatable but whose first snippet line starts with a real line nearby.

| config | reps | mean cost | mean wall s | strict recall | lenient recall | precision |
|---|---|---|---|---|---|---|
| h55-ex10-f100-t50k-verbatim-batchapi | 1 | $0.022 | 2738 | 52.1% | 52.1% | 99.0% |
| h55-ex10-f100-t50k-verbatim | 2 | $0.043 | 152 | 54.4% (52.1–56.8) | 54.4% | 98.2% |
| h55-ex25-f100-t50k | 2 | $0.062 | 150 | 25.8% (18.2–33.3) | 56.5% | 99.2% |
| h55-ex10-f20 | 1 | $0.067 | 140 | 19.8% | 75.0% | 100.0% |
| **h55-ex10-f20-t50k-verbatim** | 2 | **$0.075** | 221 | **69.0% (68.8–69.3)** | 69.0% | 98.1% |
| h55-ex25-f20 | 2 | $0.092 | 162 | 23.4% (21.4–25.5) | 66.7% | 100.0% |
| h55-ex25-f20-t50k-verbatim | 2 | $0.096 | 167 | 67.7% (66.7–68.8) | 67.7% | 99.6% |
| h55-f20-t50k-batchapi | 1 | $0.126 | 2246 | 19.3% | 58.9% | 100.0% |
| h55-f50-t50k | 2 | $0.248 | 298 | 13.3% (11.5–15.1) | 53.4% | 97.8% |
| h55-f20-t50k | 2 | $0.256 | 157 | 25.8% (21.9–29.7) | 60.4% | 98.8% |
| h55-f20-t50k-verbatim | 2 | $0.264 | 204 | 70.6% (69.3–71.9) | 70.6% | 99.6% |
| h55-f5 | 2 | $0.309 | 272 | 29.7% (29.2–30.2) | 69.3% | 97.5% |
| h55-f5-verbatim | 2 | $0.330 | 318 | 71.6% (69.8–73.4) | 71.6% | 98.2% |
| h55-f20-none | 1 | $0.579 | 83 | 25.5% | 40.1% | 98.0% |
| h55-f20 (current CI default) | 2 | $0.652 | 143 | 18.8% (16.1–21.4) | 58.1% | 98.8% |
| h55-f20-high | 1 | $0.857 | 359 | 29.2% | 68.2% | 100.0% |
| h55-f200 | 1 | $1.027 | 93 | 4.7% | 7.8% | 100.0% |
| h55-f50 | 2 | $1.091 | 121 | 16.9% (9.9–24.0) | 29.9% | 97.9% |
| h45-f20 | 1 | $1.881 | 209 | 34.9% | 40.1% | 88.2% |
| s55-f5 | 1 | $5.232 | 251 | 82.3% | 82.3% | 97.5% |

Costs are cold full scans. In CI the scan cache only re-sends changed files, so
the daily cost is a fraction of these numbers; the ratios between configs still
apply.

## Findings

1. **Haiku 5.5 costs 5x for requests with 100k+ prompt tokens.** The tier
   applies to input and output and is only visible in
   `/api/v1/models/<id>/endpoints` (`pricing.overrides`, `min_prompt_tokens:
   100000`). Code tokenizes at ~2.4 chars/token, not the 4 that `batchFiles`
   assumes, so the 80k cap really allows ~133k tokens. In a default scan, the 7
   of 27 requests over 100k were 77% of the cost. A 50k cap (~85–90k real
   tokens) cuts the default scan from $0.65 to $0.26 with the same recall.
2. **Most of the recall loss is `locateFinding`, not the model.** Haiku often
   flattens a multi-line construct into one abbreviated snippet line
   (`class Foo extends Component<P> { ... render() {...} }`). No file line
   matches it exactly, so the scanner drops correct findings: 91–115 per
   default scan. One added prompt sentence ("copy each snippet verbatim ...
   do not join lines or abbreviate") took strict recall from ~19–26% to ~70%,
   for 3–7% more cost. With the current prompt, CI finds 0 of 3
   `no-callback-api-request` violations and 17 of 32 class components.
3. **Excerpts cut input by 5–9x and keep recall.** Sending ±10 lines around
   each prefilter match, instead of whole files, gives the same ~69–71% recall
   as whole files with verbatim snippets.
4. **Bigger batches lose recall.** At 50–200 files per request, recall falls to
   5–17% and is unstable between reps (e.g. 9.9% vs 24.0%). The 1M context
   window does not help this task.
5. **Reasoning effort and Haiku 4.5 do not help.** With `effort: none`, output
   tokens hardly drop (the model writes longer explanations instead). With
   `high`, cost is 1.3x and recall about the same. Haiku 4.5 costs 2.9x and
   finds less.
6. **The Batch API is exactly 50% cheaper but each submission waits 6–16 min.**
   That latency is fine for a daily cron, but on the cheap configs it saves
   about $0.02–0.04 per cold scan. That does not justify adding async
   submit/poll code.
7. **The remaining gap is `no-custom-render-helper`.** With verbatim snippets,
   Haiku 5.5 gets 6–8/9, 3/3 and 28–30/32 on the other three conventions, but only
   90–100/148 render helpers, where Sonnet 5.5 gets 116/148. Sonnet's overall
   82% costs 70x more than the recommended config.

## Recommendation

Use Haiku 5.5 with verbatim snippets, ~10-line excerpts around the prefilter
matches, at most 20 files per request, and a batch cap that keeps each request
under 100k real tokens (`h55-ex10-f20-t50k-verbatim`): **$0.075 and 69% recall,
vs. $0.65 and 19% for the current default.**

To implement in the scanner:
- Add the verbatim-snippet sentence to `buildPrompt`, and/or make
  `locateFinding` accept a nearby line that starts the snippet's first line.
- Count tokens at ~2.4 chars/token (or lower `MAX_TOKENS_PER_BATCH` to ~50k).
- Excerpting needs an anchor regex for each convention. It could reuse the
  prefilter's grep pattern, or come from a new optional convention field.
