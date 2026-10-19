#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${TAGS:?TAGS is required}"
: "${GITHUB_WORKFLOW_REF:?GITHUB_WORKFLOW_REF is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
if (( $# != 2 )); then
  echo 'Expected amd64 and arm64 image references.' >&2
  exit 1
fi

args=()
while IFS= read -r tag; do
  [[ -z "$tag" ]] || args+=(--tag "$tag")
done <<< "$TAGS"
if (( ${#args[@]} == 0 )); then
  echo 'No public image tags supplied.' >&2
  exit 1
fi

metadata=$(mktemp)
trap 'rm -f "$metadata"' EXIT
docker buildx imagetools create --metadata-file "$metadata" "${args[@]}" "$@"
# Use the merged index digest, never a child manifest or image config digest.
digest=$(python3 - "$metadata" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    digest = json.load(source).get("containerimage.digest", "")
if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
    raise SystemExit("Missing or invalid merged image digest")
print(digest)
PY
)
ref="$IMAGE@$digest"
if cosign verify \
  --certificate-identity="https://github.com/$GITHUB_WORKFLOW_REF" \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  "$ref" >/dev/null 2>&1; then
  echo "Already signed by this workflow: $ref"
else
  # All public tags share this index. Sign it once; genuine signing errors fail.
  cosign sign --yes "$ref"
fi

while IFS= read -r tag; do
  [[ -z "$tag" ]] && continue
  docker buildx imagetools inspect "$tag" >> "$GITHUB_STEP_SUMMARY"
done <<< "$TAGS"
