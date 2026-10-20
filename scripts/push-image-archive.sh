#!/usr/bin/env bash
set -euo pipefail
if (( $# != 3 )); then
  echo 'Expected OCI archive path, destination image tag and build digest.' >&2
  exit 2
fi
archive=$1
destination=$2
expected=$3
if [[ ! -f "$archive" || ! "$expected" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'Missing OCI archive or invalid build digest.' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
digest_file=$(mktemp)
trap 'rm -f "$digest_file"' EXIT
# Docker login-action writes credentials here. --all keeps the SBOM/provenance
# manifests, and --preserve-digests ensures cosign signs the exact build output.
bash "$script_dir/retry-registry.sh" skopeo copy \
  --authfile "${DOCKER_CONFIG:-$HOME/.docker}/config.json" \
  --all --preserve-digests --digestfile "$digest_file" \
  "oci-archive:$archive" "docker://$destination"
actual=$(tr -d '\r\n' < "$digest_file")
if [[ "$actual" != "$expected" ]]; then
  echo "Published digest does not match build output: expected $expected, got $actual" >&2
  exit 1
fi
echo "Published and checked $destination@$actual"
