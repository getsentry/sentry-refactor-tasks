#!/usr/bin/env bash
# Runs the benchmark grid sequentially so per-config latency isn't skewed by
# other configs competing for the same rate limits. Finished labels are skipped,
# so the grid can be re-run after an interruption.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=${REPO:-$HOME/code/sentry}
export INFERENCE_PROVIDER=openrouter
H55=anthropic/claude-haiku-5.5
H45=anthropic/claude-haiku-4.5
S55=anthropic/claude-sonnet-5.5

run() {
  label=$1
  shift
  [ -f "bench/results/$label.json" ] && return
  node bench/run.ts --repo "$REPO" --label "$label" "$@" 2>&1 | grep -v '^direnv'
}

for rep in 1 2; do
  run h55-f20-r$rep --model $H55 --files 20 --tokens 80000
  run h55-f5-r$rep --model $H55 --files 5 --tokens 20000
  run h55-f50-r$rep --model $H55 --files 50 --tokens 200000
  run h55-ex25-f20-r$rep --model $H55 --files 20 --tokens 80000 --excerpt 25
done
run h55-f200-r1 --model $H55 --files 200 --tokens 400000
run h55-ex25-f100-r1 --model $H55 --files 100 --tokens 200000 --excerpt 25
run h55-ex10-f20-r1 --model $H55 --files 20 --tokens 80000 --excerpt 10
run h55-f20-none-r1 --model $H55 --files 20 --tokens 80000 --reasoning none
run h55-f20-high-r1 --model $H55 --files 20 --tokens 80000 --reasoning high
run h45-f20-r1 --model $H45 --files 20 --tokens 80000
run s55-f5-r1 --model $S55 --files 5 --tokens 20000
for rep in 1 2; do
  run h55-ex10-f100-t50k-verbatim-r$rep --model $H55 --files 100 --tokens 50000 --excerpt 10 --verbatim-snippet
  run h55-ex25-f20-t50k-verbatim-r$rep --model $H55 --files 20 --tokens 50000 --excerpt 25 --verbatim-snippet
done
run h55-ex10-f100-t50k-verbatim-batchapi-r1 --model $H55 --files 100 --tokens 50000 --excerpt 10 --verbatim-snippet --batch-api
