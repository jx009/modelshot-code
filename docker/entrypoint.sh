#!/bin/sh
set -eu

# The published Web build deliberately uses the unsigned C2PA implementation.
if [ "${C2PA_ENABLED:-0}" = "1" ]; then
  echo 'The published image is unsigned; C2PA requires a separately validated signing build.' >&2
  exit 1
fi

case "${1:-web}" in
  web) shift; exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}" "$@" ;;
  worker) shift; exec node src/workers/main.mjs "$@" ;;
  migrate) shift; exec node node_modules/prisma/build/index.js migrate deploy "$@" ;;
  ops) shift; exec node scripts/ops.mjs "$@" ;;
  *) exec "$@" ;;
esac
