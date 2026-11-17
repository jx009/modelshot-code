#!/usr/bin/env bash
# Copy the already-published public tags to a regional registry so a slow or
# filtered path to Docker Hub is not on the deploy critical path. The merged
# multi-arch indexes are reused as-is; nothing is rebuilt here.
set -euo pipefail
: "${IMAGE:?Missing IMAGE}" "${MIRROR_IMAGE:?Missing MIRROR_IMAGE}" "${SHA:?Missing SHA}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# main publishes latest, sha-<sha>, tools-latest and tools-sha-<sha>.
tags=(latest "sha-$SHA" tools-latest "tools-sha-$SHA")
for tag in "${tags[@]}"; do
  source_ref="$IMAGE:$tag"
  target_ref="$MIRROR_IMAGE:$tag"
  bash "$script_dir/retry-registry.sh" docker buildx imagetools create --tag "$target_ref" "$source_ref"
  # Read the copy back so a partial upload cannot be mistaken for a mirror hit.
  bash "$script_dir/retry-registry.sh" docker buildx imagetools inspect "$target_ref" >/dev/null
  echo "Mirrored $source_ref -> $target_ref"
done
