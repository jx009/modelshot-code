#!/usr/bin/env bash
# Copy the already-published public tags to a regional registry so a slow or
# filtered path to Docker Hub is not on the deploy critical path. The merged
# multi-arch indexes are reused as-is; nothing is rebuilt here.
#
# The first copy of each tag uploads every layer over the runner's uplink
# (~500 KB/s to a mainland registry in practice), which is tens of minutes for
# the tools image. Later tags share the same blobs and finish in seconds, and a
# tag already carrying the same digest is skipped entirely.
set -euo pipefail
: "${IMAGE:?Missing IMAGE}" "${MIRROR_IMAGE:?Missing MIRROR_IMAGE}" "${SHA:?Missing SHA}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
per_tag_timeout=${MIRROR_TAG_TIMEOUT_SECONDS:-2700}

digest_of() {
  local text
  text=$(bash "$script_dir/retry-registry.sh" docker buildx imagetools inspect "$1" 2>/dev/null) || return 1
  # The index digest line is the first "Digest:" of the multi-arch index.
  awk '/^Digest:/{print $2; exit}' <<< "$text"
}

# main publishes latest, sha-<sha>, tools-latest, tools-sha-<sha> and the
# dedicated export image (export-latest, export-sha-<sha>).
tags=(latest "sha-$SHA" tools-latest "tools-sha-$SHA" export-latest "export-sha-$SHA")
failed=()
for tag in "${tags[@]}"; do
  source_ref="$IMAGE:$tag"
  target_ref="$MIRROR_IMAGE:$tag"
  source_digest=$(digest_of "$source_ref" || true)
  if [ -z "$source_digest" ]; then
    # 导出镜像构建失败或该 ref 没有对应标签时，跳过而不是让整轮同步失败。
    echo "::notice::$source_ref is not published; skipping."
    continue
  fi
  target_digest=$(digest_of "$target_ref" || true)
  if [ -n "$source_digest" ] && [ "$source_digest" = "$target_digest" ]; then
    echo "Already mirrored $target_ref ($source_digest); skipping."
    continue
  fi
  # A single tag must not exhaust the job budget: give each its own ceiling so
  # the remaining tags still get a chance when the uplink is slow.
  if ! timeout "$per_tag_timeout" bash "$script_dir/retry-registry.sh" \
      docker buildx imagetools create --tag "$target_ref" "$source_ref"; then
    echo "::warning::Mirroring $target_ref failed or timed out; continuing with the rest."
    failed+=("$tag")
    continue
  fi
  # Read the copy back so a partial upload cannot be mistaken for a mirror hit.
  bash "$script_dir/retry-registry.sh" docker buildx imagetools inspect "$target_ref" >/dev/null
  echo "Mirrored $source_ref -> $target_ref"
done

if (( ${#failed[@]} )); then
  echo "::warning::Not mirrored: ${failed[*]}. Re-run the workflow to resume; finished tags are skipped."
  exit 1
fi
