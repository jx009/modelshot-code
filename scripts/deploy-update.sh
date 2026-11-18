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
compose pull web worker creation-worker creation-language migrate
compose run --rm --no-deps migrate
if [ "${1:-}" = "--tools" ]; then
  compose pull tools
  compose up -d --no-deps --no-build --wait tools
fi
compose up -d --no-deps --no-build --wait web worker creation-worker creation-language
# 配置了专用导出镜像时，同步更新导出服务；它必须和应用镜像同版本，否则导出心跳版本对不上。
if grep -Eq '^CREATION_EXPORT_IMAGE=.+' .env.production; then
  compose --profile office-import pull creation-export
  compose --profile office-import up -d --no-deps --no-build creation-export
fi
compose --profile office-import ps
