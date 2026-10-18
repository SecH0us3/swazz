#!/bin/sh
set -e

# 1. Run migrations for D1 SQLite database
npx wrangler d1 migrations apply swazz_db --local --yes

# 2. Shared runners authenticate with an operator token supplied at start; the image ships no
#    built-in credential. Without SWAZZ_RUNNER_TOKEN, runners can still connect with a user's own
#    API key, and then serve only that user's scans.
if [ -n "${SWAZZ_RUNNER_TOKEN:-}" ]; then
  set -- --var "SHARED_RUNNER_TOKEN:${SWAZZ_RUNNER_TOKEN}" \
         --var "SHARED_RUNNERS_ALLOW_PRIVATE_IPS:${SWAZZ_SHARED_RUNNERS_ALLOW_PRIVATE_IPS:-false}"
fi

# 3. Start wrangler dev in local mode, listening on all interfaces
exec npx wrangler dev src/index.ts --ip 0.0.0.0 --port 8080 --local "$@"
