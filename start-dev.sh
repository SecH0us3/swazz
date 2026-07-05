#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=== Starting Swazz Interactive Dev Environment ==="

# Configure bypass secret
echo 'JWT_SECRET="test-secret"' > packages/edge/.dev.vars
echo 'AUTH_ENABLED="true"' >> packages/edge/.dev.vars
echo 'LIMIT_ANONYMOUS="true"' >> packages/edge/.dev.vars
echo 'TURNSTILE_SITE_KEY="1x00000000000000000000AA"' >> packages/edge/.dev.vars

# Create dummy wordlist folder and file
mkdir -p wordlists
echo "dummy-xss-payload" > wordlists/xss-custom.txt

PIDS=()
cleanup() {
  if [ ${#PIDS[@]} -ne 0 ]; then
    echo -e "\n=== Shutting down all Swazz services (PIDS: ${PIDS[*]}) ==="
    for pid in "${PIDS[@]}"; do
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done
  fi
  rm -rf wordlists
}
trap cleanup EXIT INT TERM

# Helper function to check if port is in use
check_port() {
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z localhost "$1" >/dev/null 2>&1
}

# Wait dynamically for a port to open
wait_for_port() {
  local port="$1"
  local name="$2"
  for i in {1..15}; do
    if check_port "$port"; then
      return 0
    fi
    sleep 1
  done
  echo "✗ Error: $name on port $port failed to start within 15 seconds."
  exit 1
}

# Pre-cleanup: kill any processes on ports 8788, 8787, 5173
lsof -ti :8788,8787,5173 | xargs kill -9 2>/dev/null || true
pkill -f "swazz-engine" || true
sleep 1

# 1. Start Vulnerable Demo API (Port 8788)
echo "→ Starting Vulnerable Demo API (wrangler dev on port 8788)..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --port 8788 --cwd demo --log-level error > demo.log 2>&1 &
PIDS+=($!)
wait_for_port 8788 "Vulnerable Demo API"

# 2. Start Edge Coordinator (Port 8787)
echo "→ Applying local database migrations..."
npx wrangler d1 migrations apply swazz_db --local --cwd packages/edge || true
npx wrangler d1 execute swazz_db --local --command "INSERT OR IGNORE INTO users (id, username, password_hash, api_key, plan) VALUES ('01H9YZECI00000000000000000', 'ci_user', 'no-hash-needed-for-token', 'swazz_live_citoken1234567890', 'Supporter Plan');" --cwd packages/edge || true
echo "→ Starting Edge Coordinator (wrangler dev on port 8787)..."
NODE_OPTIONS="--max-old-space-size=4096" JWT_SECRET="test-secret" npx wrangler dev --cwd packages/edge --port 8787 --log-level error > edge.log 2>&1 &
PIDS+=($!)
wait_for_port 8787 "Edge Coordinator"

# 3. Start React Web Frontend (Port 5173)
echo "→ Starting React Web Frontend (Vite dev server on port 5173)..."
npm run dev:frontend > web.log 2>&1 &
PIDS+=($!)
wait_for_port 5173 "React Web Frontend"

# 4. Compile and start Go Runner Agent
echo "→ Compiling Go Runner Agent..."
(cd packages/container && go build -o swazz-engine)

echo "→ Starting Go Runner Agent..."
./packages/container/swazz-engine run-agent \
  --coordinator ws://127.0.0.1:8787/api/runners/connect \
  --token swazz_live_citoken1234567890 \
  --dangerous-no-container > packages/container/agent.log 2>&1 &
PIDS+=($!)

echo "========================================================="
echo "  Swazz Interactive Environment is fully online!"
echo "  - Web UI: http://localhost:5173"
echo "  - Edge Coordinator: http://localhost:8787"
echo "  - Vulnerable Demo API: http://localhost:8788"
echo "========================================================="
echo "Press Ctrl+C to shut down all services."

# Keep parent script alive to support signal traps and active logs
while true; do
  sleep 1
done
