#!/usr/bin/env bash
# Prints the local coordinator's shared runner token, creating it on first use.
#
# The coordinator only accepts a shared runner (one that takes every user's scans) with this
# operator token; there is no built-in credential. Local dev and e2e scripts pass it to
# `wrangler dev` as SHARED_RUNNER_TOKEN and to the agent as --token. It lives under the
# gitignored .wrangler directory so an already-running coordinator and a newly started agent
# agree on it across script runs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$ROOT_DIR/packages/edge/.wrangler/runner-token"

if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"
  (umask 077 && openssl rand -hex 32 > "$TOKEN_FILE")
fi
cat "$TOKEN_FILE"
