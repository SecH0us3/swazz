#!/bin/sh
set -e

# 1. Run migrations for D1 SQLite database
npx wrangler d1 migrations apply swazz_db --local --yes

# 2. Seed the default CI user for local runner agent connections
npx wrangler d1 execute swazz_db --local --command "INSERT OR IGNORE INTO users (id, username, password_hash, api_key, plan) VALUES ('01H9YZECI00000000000000000', 'ci_user', 'no-hash-needed-for-token', 'swazz_live_citoken1234567890', 'Supporter Plan');"

# 3. Start wrangler dev in local mode, listening on all interfaces
exec npx wrangler dev src/index.ts --ip 0.0.0.0 --port 8080 --local
