#!/usr/bin/env bash

# Set working directory to the project root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Starting Swazz Local Environment ==="
echo "Project Root: $ROOT_DIR"

# 1. Kill existing services on ports 8788, 8787, 5173
echo "→ Stopping any existing services on ports 8788, 8787, 5173..."
lsof -ti :8788,8787,5173 | xargs kill -9 2>/dev/null || true
pkill -f "swazz-engine" || true
sleep 1

# 2. Setup Dev Vars
echo 'JWT_SECRET="test-secret"' > packages/edge/.dev.vars
echo 'AUTH_ENABLED="true"' >> packages/edge/.dev.vars
echo 'LIMIT_ANONYMOUS="true"' >> packages/edge/.dev.vars
echo 'TURNSTILE_SITE_KEY="1x00000000000000000000AA"' >> packages/edge/.dev.vars
echo 'ADMIN_SECRET="test-admin-secret"' >> packages/edge/.dev.vars

# 3. Setup Database
echo "→ Applying local database migrations..."
npx wrangler d1 migrations apply swazz_db --local --cwd packages/edge || true
echo "→ Seeding CI runner user..."
npx wrangler d1 execute swazz_db --local --command "INSERT OR IGNORE INTO users (id, username, password_hash, api_key, plan) VALUES ('01H9YZECI00000000000000000', 'ci_user', 'no-hash-needed-for-token', '0c4000e5af58b58dac6d8f190a5e4960441c0d8b6370b09096900931f87df527', 'Supporter Plan');" --cwd packages/edge || true

# 4. Start React Web Frontend (Port 5173)
echo "→ Starting React Web Frontend on http://localhost:5173 ..."
npm run dev:frontend > web.log 2>&1 &

# 5. Start Edge Coordinator (Port 8787)
echo "→ Starting Edge Coordinator on http://localhost:8787 ..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --cwd packages/edge --var JWT_SECRET:test-secret --var BETA_MODE_ENABLED:true --var BETA_USER_LIMIT:5000 --log-level error --inspector-port=9230 > edge.log 2>&1 &

# 6. Start Vulnerable Demo API (Port 8788)
echo "→ Starting Vulnerable Demo API on http://localhost:8788 ..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --port 8788 --cwd demo --log-level error --inspector-port=9231 > demo.log 2>&1 &

# 7. Build and start Go Runner Agent
echo "→ Compiling Go Runner Agent..."
(cd packages/container && go build -o swazz-engine)
echo "→ Starting Go Runner Agent..."
sleep 3
./packages/container/swazz-engine run-agent \
  --coordinator ws://127.0.0.1:8787/api/runners/connect \
  --token swazz_live_citoken1234567890 \
  --dangerous-no-container > packages/container/agent.log 2>&1 &

echo "=== Local Environment Started ==="
echo "Frontend: http://localhost:5173"
echo "Coordinator: http://localhost:8787"
echo "Vulnerable Demo API: http://localhost:8788"
echo "Logs are available at web.log, edge.log, demo.log, and packages/container/agent.log"
