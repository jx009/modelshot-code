#!/usr/bin/env bash
# GitHub runner only. Upload to staging, then publish immutable files on HK or CN.
set -euo pipefail
region=${2:?Pass HK or CN as the deployment region}
[[ "$region" == HK || "$region" == CN ]] || exit 2
for suffix in SERVER_HOST SERVER_USER SERVER_SSH_KEY SERVER_KNOWN_HOSTS; do
  name="${region}_$suffix"
  if [[ -z "${!name:-}" ]]; then echo "::error::Missing $name"; exit 1; fi
  declare "$suffix=${!name}"
done
[[ -n "${BUILD_TAG:-}" ]] || { echo '::error::Missing BUILD_TAG'; exit 1; }
[[ "$SERVER_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$SERVER_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || exit 2
[[ "$BUILD_TAG" =~ ^build-[a-f0-9]+-[0-9]+-[0-9]+$ ]] || exit 2
name="${region}_SERVER_PORT"
port=${!name:-22}
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || exit 2
name="${region}_STATIC_BWLIMIT_KIB"
bandwidth=${!name:-0}
[[ "$bandwidth" =~ ^[0-9]{1,8}$ ]] || exit 2
bandwidth=$((10#$bandwidth))
source_dir=${1:?Pass the extracted static directory}
[[ -d "$source_dir" ]] || exit 2
credentials=$(mktemp -d "${RUNNER_TEMP:-/tmp}/static-$region-ssh.XXXXXX")
trap 'rm -rf -- "$credentials"' EXIT
printf '%s\n' "$SERVER_SSH_KEY" | tr -d '\r' > "$credentials/key"
printf '%s\n' "$SERVER_KNOWN_HOSTS" | tr -d '\r' > "$credentials/known_hosts"
chmod 600 "$credentials/key" "$credentials/known_hosts"
ssh_options=(-i "$credentials/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$credentials/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
remote="$SERVER_USER@$SERVER_HOST"
retry_transfer() {
  local label="$1"
  shift
  local attempt status
  local delays=(10 20 40)
  local results
  for attempt in 0 1 2 3; do
    echo "::notice::$label (attempt $((attempt + 1))/4)"
    set +e
    "$@" 2>&1 | tee "$credentials/transfer.log"
    results=("${PIPESTATUS[@]}")
    set -e
    status=${results[0]}
    if (( results[1] != 0 )); then
      echo "::error::Unable to record deployment output."
      return 1
    fi
    if (( status == 0 )); then return 0; fi
    if grep -Eiq 'Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No space left on device|Immutable asset conflict' "$credentials/transfer.log"; then
      echo "::error::$label failed (exit $status); configuration or data errors are not retried."
      return "$status"
    fi
    if (( attempt == 3 )) || ! {
      [[ "$1" == rsync && "$status" =~ ^(10|12|30|35)$ ]] ||
      { (( status == 255 )) && grep -Eiq 'Timeout, server|Connection timed out|Connection reset|Connection closed|Broken pipe|Network is unreachable|No route to host|Connection refused|Temporary failure in name resolution' "$credentials/transfer.log"; }
    }; then
      echo "::error::$label failed (exit $status); stopping without advancing the release."
      return "$status"
    fi
    echo "::warning::$label interrupted; retrying in ${delays[$attempt]} seconds."
    sleep "${delays[$attempt]}"
  done
}
# Staging is outside the web root, separate for every workflow attempt.
stage="/www/wwwroot/.letaidraw-static-staging/$BUILD_TAG"
target=/www/wwwroot/www.letaidraw.com/_next/static
retry_transfer "Prepare $region staging" ssh -p "$port" "${ssh_options[@]}" "$remote" \
  "set -eu; umask 022; python3 --version; command -v rsync; mkdir -p '$stage/static' '$stage/partials' '$target'"
printf -v remote_shell '%q ' ssh -p "$port" "${ssh_options[@]}"
# No --delete, --inplace or directory replacement. This is an isolated staging area.
retry_transfer "Upload static assets" rsync -r --checksum --chmod=D755,F644 \
  --partial-dir="$stage/partials" --timeout=180 --bwlimit="$bandwidth" --stats \
  -e "$remote_shell" -- "$source_dir/" "$remote:$stage/static/"
retry_transfer "Upload static publisher" scp -P "$port" "${ssh_options[@]}" scripts/publish-static.py "$remote:$stage/publish-static.py"
retry_transfer "Publish immutable static assets" ssh -p "$port" "${ssh_options[@]}" "$remote" \
  "set -eu; umask 022; python3 '$stage/publish-static.py' '$stage/static' '$target'"
if ! ssh -p "$port" "${ssh_options[@]}" "$remote" "rm -rf -- '$stage'"; then
  echo "::warning::Static assets published, but staging cleanup was not confirmed: $stage"
fi
