#!/usr/bin/env bash
# Fails if a deployable or dev entry point ships a built-in credential.
#
# A fixed API key once lived in the edge container entrypoint, the compose file and the dev
# scripts: every coordinator started from the image accepted it as a paid-plan user and as a
# shared runner that received other tenants' scan configs. Credentials must come from the
# operator at start (see scripts/runner-token.sh and SHARED_RUNNER_TOKEN), never from the repo.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
status=0

# 1. No API-key-shaped literal anywhere outside tests, docs and build output.
if git grep -nE 'swazz_live_[A-Za-z0-9]{6,}' -- . \
    ':!*.test.ts' ':!*.test.tsx' ':!*_test.go' ':!docs/**' ':!**/dist/**' ':!packages/container/web/**' \
    ':!scripts/check-builtin-credentials.sh'; then
  echo "error: API-key-shaped literal found above; read credentials from the environment instead." >&2
  status=1
fi

# 2. No entry point or script seeds user accounts into the database.
if git grep -niE 'insert[[:space:]]+(or[[:space:]]+ignore[[:space:]]+)?into[[:space:]]+users' -- \
    '*.sh' '**/Dockerfile*' 'compose*.yml' 'deploy/**' ':!scripts/check-builtin-credentials.sh'; then
  echo "error: a script or entry point seeds a user account above; create accounts at runtime." >&2
  status=1
fi

exit $status
