#!/usr/bin/env bash
# Backwards-compatible entry point for the existing Hong Kong deployment.
set -euo pipefail
exec bash "$(dirname "$0")/deploy-static.sh" "${1:?Pass the extracted static directory}" HK
