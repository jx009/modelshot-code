#!/bin/sh
# Update an existing healthy installation without rebuilding its data services.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
compose() { docker compose --env-file .env.production -f compose.prod.yaml "$@"; }
case "${1:-}" in
  ""|--tools) ;;
  *) echo 'Usage: sh scripts/deploy-update.sh [--tools]' >&2; exit 2 ;;
esac
running=$(compose ps --services --status running)
for service in postgres redis storage; do
  if ! printf '%s\n' "$running" | grep -qx "$service"; then
    echo "Existing $service service must be running; use the first-install procedure instead." >&2
    exit 1
  fi
done
compose pull web worker migrate
compose run --rm --no-deps migrate
if [ "${1:-}" = "--tools" ]; then
  compose pull tools
  compose up -d --no-deps --no-build --wait tools
fi
compose up -d --no-deps --no-build --wait web worker
compose ps
