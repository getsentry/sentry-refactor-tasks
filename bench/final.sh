#!/usr/bin/env bash
# Remaining runs against a frozen snapshot. Batch API runs wait in a remote
# queue, so they go in parallel with the synchronous runs without skewing them.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=${REPO:?set REPO to a frozen checkout}
export INFERENCE_PROVIDER=openrouter
H55=anthropic/claude-haiku-5.5

run() {
  label=$1
  shift
  [ -f "bench/results/$label.json" ] && return
  node bench/run.ts --repo "$REPO" --label "$label" "$@" 2>&1 | grep -v '^direnv'
}

run h55-f20-t50k-batchapi-r1 --model $H55 --files 20 --tokens 50000 --batch-api &
run h55-ex10-f100-t50k-verbatim-batchapi-r1 --model $H55 --files 100 --tokens 50000 --excerpt 10 --verbatim-snippet --batch-api &

run h55-f20-r1 --model $H55 --files 20 --tokens 80000
run h55-f5-r1 --model $H55 --files 5 --tokens 20000
run h55-f50-r1 --model $H55 --files 50 --tokens 200000
run h55-ex25-f20-r1 --model $H55 --files 20 --tokens 80000 --excerpt 25
for rep in 1 2; do
  run h55-f5-verbatim-r$rep --model $H55 --files 5 --tokens 20000 --verbatim-snippet
  run h55-f20-t50k-verbatim-r$rep --model $H55 --files 20 --tokens 50000 --verbatim-snippet
  run h55-ex10-f100-t50k-verbatim-r$rep --model $H55 --files 100 --tokens 50000 --excerpt 10 --verbatim-snippet
  run h55-ex25-f20-t50k-verbatim-r$rep --model $H55 --files 20 --tokens 50000 --excerpt 25 --verbatim-snippet
  run h55-ex10-f20-t50k-verbatim-r$rep --model $H55 --files 20 --tokens 50000 --excerpt 10 --verbatim-snippet
done
wait
echo "final done"
