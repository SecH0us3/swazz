#!/usr/bin/env bash
set -e

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "Error occurred. Cleaning up background processes..."
    kill $(jobs -p) 2>/dev/null || true
  fi
}
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Starting Swazz Dev Environment ==="

# Set environment vars for coordinator
echo 'JWT_SECRET="test-secret"' > packages/edge/.dev.vars
echo 'AUTH_ENABLED="true"' >> packages/edge/.dev.vars
echo 'LIMIT_ANONYMOUS="true"' >> packages/edge/.dev.vars
echo 'TURNSTILE_SITE_KEY="1x00000000000000000000AA"' >> packages/edge/.dev.vars
echo 'ADMIN_SECRET="test-admin-secret"' >> packages/edge/.dev.vars

# Apply migrations and seed CI user
echo "→ Applying local database migrations..."
npx wrangler d1 migrations apply swazz_db --local --cwd packages/edge || true
echo "→ Seeding CI runner user..."
npx wrangler d1 execute swazz_db --local --command "INSERT OR IGNORE INTO users (id, username, password_hash, api_key, plan) VALUES ('01H9YZECI00000000000000000', 'ci_user', 'no-hash-needed-for-token', '0c4000e5af58b58dac6d8f190a5e4960441c0d8b6370b09096900931f87df527', 'Supporter Plan');" --cwd packages/edge || true

# Start services
echo "→ Starting Vulnerable Demo API (Port 8788)..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --port 8788 --inspector-port 9230 --cwd demo --log-level error > demo.log 2>&1 &

echo "→ Starting Edge Coordinator (Port 8787)..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --inspector-port 9229 --cwd packages/edge --var JWT_SECRET:test-secret --var BETA_MODE_ENABLED:true --var BETA_USER_LIMIT:5000 --log-level error > edge.log 2>&1 &

echo "→ Starting React Web Frontend (Port 5173)..."
npm run dev:frontend > web.log 2>&1 &

echo "→ Compiling Go Runner Agent..."
(cd packages/container && go build -o swazz-engine)

echo "→ Waiting for Edge Coordinator to start on port 8787..."
for i in {1..30}; do
  if (echo > /dev/tcp/127.0.0.1/8787) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "→ Starting Go Runner Agent..."
./packages/container/swazz-engine run-agent \
  --coordinator ws://127.0.0.1:8787/api/runners/connect \
  --token swazz_live_citoken1234567890 \
  --dangerous-no-container > packages/container/agent.log 2>&1 &

echo "=== Swazz is now running! ==="
echo "  - Web Dashboard: http://localhost:5173"
echo "  - Edge Coordinator API: http://localhost:8787"
echo "  - Vulnerable Demo API: http://localhost:8788"
echo ""
echo "Logs are available at: demo.log, edge.log, web.log, packages/container/agent.log"
echo "To stop all services, run: pkill -f wrangler; pkill -f vite; pkill -f swazz-engine"
