#!/usr/bin/env bash
# Batch caps that keep each request under Haiku 5.5's 100k-prompt-token price
# tier. --tokens is the scanner's chars/4 estimate; real code tokenizes at ~2.4
# chars/token, so 50k estimated is ~85-90k real.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=${REPO:-$HOME/code/sentry}
export INFERENCE_PROVIDER=openrouter
H55=anthropic/claude-haiku-5.5

run() {
  label=$1
  shift
  [ -f "bench/results/$label.json" ] && return
  node bench/run.ts --repo "$REPO" --label "$label" "$@" 2>&1 | grep -v '^direnv'
}

for rep in 1 2; do
  run h55-f20-t50k-r$rep --model $H55 --files 20 --tokens 50000
  run h55-f50-t50k-r$rep --model $H55 --files 50 --tokens 50000
  run h55-ex25-f100-t50k-r$rep --model $H55 --files 100 --tokens 50000 --excerpt 25
done
run h55-f20-t50k-batchapi-r1 --model $H55 --files 20 --tokens 50000 --batch-api
for rep in 1 2; do
  run h55-f5-verbatim-r$rep --model $H55 --files 5 --tokens 20000 --verbatim-snippet
  run h55-f20-t50k-verbatim-r$rep --model $H55 --files 20 --tokens 50000 --verbatim-snippet
done
