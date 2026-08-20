#!/usr/bin/env bash
# Capture every shot, relaunching when a session cannot read its pixels back.
# Exit 75 from capture.mjs means "dud session, try again".
set -u
cd "$(dirname "$0")/.."
for s in skyline street vault door; do
  echo "=== $s ==="
  for try in 1 2 3 4 5 6 7 8; do
    node scripts/capture.mjs "$s" 2>&1 | grep -E "readback|in [0-9]+\.|wrote|WARNING|RELAUNCH|DEAD"
    if [ "${PIPESTATUS[0]}" != "75" ]; then break; fi
    echo "   retry $try"
  done
done
echo "ALL SHOTS DONE"
