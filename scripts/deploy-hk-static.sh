#!/usr/bin/env bash
# GitHub runner only. Upload to staging, then publish immutable files on Hong Kong.
set -euo pipefail
for name in HK_SERVER_HOST HK_SERVER_USER HK_SERVER_SSH_KEY HK_SERVER_KNOWN_HOSTS BUILD_TAG; do
  if [[ -z "${!name:-}" ]]; then echo "::error::Missing $name"; exit 1; fi
done
[[ "$HK_SERVER_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || exit 2
[[ "$HK_SERVER_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || exit 2
[[ "$BUILD_TAG" =~ ^build-[a-f0-9]+-[0-9]+-[0-9]+$ ]] || exit 2
port=${HK_SERVER_PORT:-22}
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || exit 2
source_dir=${1:?Pass the extracted static directory}
[[ -d "$source_dir" ]] || exit 2
credentials=$(mktemp -d "${RUNNER_TEMP:-/tmp}/hk-ssh.XXXXXX")
trap 'rm -rf -- "$credentials"' EXIT
printf '%s\n' "$HK_SERVER_SSH_KEY" | tr -d '\r' > "$credentials/key"
printf '%s\n' "$HK_SERVER_KNOWN_HOSTS" | tr -d '\r' > "$credentials/known_hosts"
chmod 600 "$credentials/key" "$credentials/known_hosts"
ssh_options=(-i "$credentials/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$credentials/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$HK_SERVER_USER@$HK_SERVER_HOST"
# Staging is outside the web root, separate for every workflow attempt.
stage="/www/wwwroot/.letaidraw-static-staging/$BUILD_TAG"
target=/www/wwwroot/www.letaidraw.com/_next/static
ssh -p "$port" "${ssh_options[@]}" "$remote" \
  "set -eu; umask 022; python3 --version; command -v rsync; mkdir -p '$stage/static' '$target'"
printf -v remote_shell '%q ' ssh -p "$port" "${ssh_options[@]}"
# No --delete, --inplace or directory replacement. This is an isolated staging area.
rsync -r --checksum --chmod=D755,F644 -e "$remote_shell" -- "$source_dir/" "$remote:$stage/static/"
scp -P "$port" "${ssh_options[@]}" scripts/publish-static.py "$remote:$stage/publish-static.py"
ssh -p "$port" "${ssh_options[@]}" "$remote" \
  "set -eu; umask 022; python3 '$stage/publish-static.py' '$stage/static' '$target'; rm -rf -- '$stage'"
