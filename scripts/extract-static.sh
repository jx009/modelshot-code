#!/usr/bin/env bash
# Extract the same public assets for every edge node; never rebuild on the edge.
set -euo pipefail
: "${IMAGE:?Missing IMAGE}" "${BUILD_TAG:?Missing BUILD_TAG}"
destination=${1:?Pass the output directory}
mkdir -p "$destination"
container=
temporary=$(mktemp -d "${RUNNER_TEMP:-/tmp}/static-extract.XXXXXX")
cleanup() {
  if [[ -n "$container" ]]; then docker rm "$container" >/dev/null || true; fi
  rm -rf -- "$temporary"
}
trap cleanup EXIT
for arch in amd64 arm64; do
  image="$IMAGE:$BUILD_TAG-$arch"
  bash scripts/retry-registry.sh docker pull --platform "linux/$arch" "$image"
  container=$(docker create --platform "linux/$arch" "$image")
  extracted="$temporary/$arch"
  mkdir -p "$extracted/static" "$extracted/public"
  docker cp "$container:/app/.next/static/." "$extracted/static/"
  docker cp "$container:/app/public/studio" "$extracted/public/studio"
  docker cp "$container:/app/public/inspiration" "$extracted/public/inspiration"
  docker cp "$container:/app/.next/required-server-files.json" "$extracted/required-server-files.json"
  docker rm "$container"
  container=
  python3 scripts/prepare-hk-static.py "$extracted" "$destination" \
    --deployment-id "$BUILD_TAG" --namespace "$BUILD_TAG-$arch"
done
