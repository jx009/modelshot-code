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
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bash "$script_dir/retry-registry.sh" docker buildx imagetools create --metadata-file "$metadata" "${args[@]}" "$@"
# Use the merged index digest, never a child manifest or image config digest.
digest=$(python3 - "$metadata" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    metadata = json.load(source)
# imagetools create writes a descriptor, unlike build's containerimage.digest.
# https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/#metadata-file
descriptor = metadata.get("containerimage.descriptor", {})
digest = descriptor.get("digest", "") if isinstance(descriptor, dict) else ""
if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
    raise SystemExit("Missing or invalid containerimage.descriptor.digest in imagetools metadata")
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
  bash "$script_dir/retry-registry.sh" cosign sign --yes "$ref"
fi

while IFS= read -r tag; do
  [[ -z "$tag" ]] && continue
  bash "$script_dir/retry-registry.sh" docker buildx imagetools inspect "$tag" >> "$GITHUB_STEP_SUMMARY"
done <<< "$TAGS"
