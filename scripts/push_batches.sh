#!/bin/bash
# Remaining batches 3-7 (credentials now persisted in osxkeychain).
set -u
cd /Users/mac/PycharmProjects/TravelTrips

shas=(
  f3e71485250e83f954acbd5b57aa9c8073bf8936
  7dd1324a3acbe300fc93e6bf5cbab14f274dea38
  ee50159349d147ce7322e34828ba0e079c0efa4d
  05fbca61f3480579a139483ed49840340043e808
  fc6b49203324a7f42461ffa4ebdc396a5150acc1
)

total=${#shas[@]}
for i in "${!shas[@]}"; do
  sha=${shas[$i]}
  n=$((i + 3))
  echo "=== batch $n/7: $sha ==="
  ok=0
  for attempt in 1 2 3 4 5 6; do
    echo "--- attempt $attempt ---"
    if git push origin "$sha:refs/heads/main"; then
      ok=1
      break
    fi
    echo "batch $n attempt $attempt failed; sleeping 15s"
    sleep 15
  done
  if [ "$ok" -ne 1 ]; then
    echo "FATAL: batch $n exhausted retries; aborting"
    exit 1
  fi
  sleep 5
done

git push -u origin main && echo "ALL DONE: main is up to date on origin"
