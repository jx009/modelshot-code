#!/usr/bin/env bash
# Retry transient registry failures without rebuilding an already exported image.
set -euo pipefail
if (( $# == 0 )); then
  echo 'Expected a registry command.' >&2
  exit 2
fi
log=$(mktemp)
trap 'rm -f "$log"' EXIT
delays=(60 120 240 480)
for attempt in 0 1 2 3 4; do
  set +e
  "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  set -e
  if (( status == 0 )); then exit 0; fi
  if (( attempt == 4 )) || ! grep -Eiq '(^|[^[:alnum:]])(429|502|503|504)([^[:alnum:]]|$)|too many requests|toomanyrequests|rate exceeded|connection reset|TLS handshake timeout|i/o timeout' "$log"; then
    echo "Registry operation failed (exit $status); no further retries." >&2
    exit "$status"
  fi
  echo "::warning::Transient registry failure; retry $((attempt + 1))/4 in ${delays[$attempt]} seconds."
  sleep "${delays[$attempt]}"
done
