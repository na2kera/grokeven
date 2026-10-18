#!/usr/bin/env bash
# Phase 1 verification helper: create a request in production and poll until it leaves "accepted".
# Usage: scripts/ask.sh <client_request_id> "<text>" [max_seconds]
set -euo pipefail
cd "$(dirname "$0")/.."
DEV=$(grep -E '^DEVICE_TOKEN=' .dev.vars.production | cut -d= -f2-)
BASE=${BASE:-https://grokeven-production.na2kera.workers.dev}
CID="$1"; TEXT="$2"; MAX="${3:-300}"
BODY=$(node -e 'console.log(JSON.stringify({conversation_id:"c-phase1",client_request_id:process.argv[1],text:process.argv[2]}))' "$CID" "$TEXT")
R=$(curl -s -X POST "$BASE/v1/requests" -H "authorization: Bearer $DEV" -H "content-type: application/json" -d "$BODY")
ID=$(echo "$R" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!j.request_id){console.error(JSON.stringify(j));process.exit(2)};console.log(j.request_id)')
echo "created request_id=$ID"
START=$(date +%s)
while :; do
  S=$(curl -s "$BASE/v1/requests/$ID" -H "authorization: Bearer $DEV")
  ST=$(echo "$S" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).status)')
  EL=$(( $(date +%s) - START ))
  [ "$ST" != "accepted" ] && break
  [ "$EL" -ge "$MAX" ] && break
  sleep 2
done
echo "status=$ST elapsed=${EL}s"
echo "$S"
