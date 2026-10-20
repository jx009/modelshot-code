#!/usr/bin/env bash
# Fetch all layers before building. Every source must serve the same pinned
# platform manifest; changing registries must never change the Node release.
set -euo pipefail
if (( $# != 2 )); then
  echo 'Expected architecture (amd64/arm64) and destination OCI directory.' >&2
  exit 2
fi
case "$1" in
  amd64) digest=sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2 ;;
  arm64) digest=sha256:f71fb9ca71b1b47d4d1a009af78147ed6cdc74f9c7cfc36cbde78ff985169051 ;;
  *) echo 'Unsupported architecture.' >&2; exit 2 ;;
esac
mkdir -p "$2"
destination=$(cd -- "$2" && pwd)
digest_file=$(mktemp)
trap 'rm -f "$digest_file"' EXIT
sources=(docker.io/library/node mirror.gcr.io/library/node public.ecr.aws/docker/library/node)
for round in 1 2 3; do
  for source in "${sources[@]}"; do
    echo "Fetching Node 22.23.2 ($1), round $round/3, from $source"
    if skopeo --command-timeout 120s copy \
      --authfile "${DOCKER_CONFIG:-$HOME/.docker}/config.json" \
      --preserve-digests --digestfile "$digest_file" \
      "docker://$source@$digest" "oci:$destination:base"; then
      actual=$(tr -d '\r\n' < "$digest_file")
      if [[ "$actual" != "$digest" ]]; then
        echo 'Downloaded Node manifest does not match the pinned digest.' >&2
        exit 1
      fi
      context="oci-layout://$destination@$digest"
      echo "Node base downloaded and verified: $digest"
      if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        printf 'context=%s\n' "$context" >> "$GITHUB_OUTPUT"
      fi
      exit 0
    fi
    echo "::warning::Could not download from $source; trying another source with the same digest."
  done
  if (( round < 3 )); then sleep "$((round * 60))"; fi
done
echo '::error::All Node image sources failed. The build has not started; retry after registry limits recover.' >&2
exit 1
