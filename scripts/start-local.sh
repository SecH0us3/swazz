#!/usr/bin/env bash
set -e

# Stop existing processes
echo "Stopping any existing services on ports 8788, 8787, 5173..."
lsof -ti :8788,8787,5173 | xargs kill -9 2>/dev/null || true
pkill -f "swazz-engine" || true
sleep 1

# Setup dev vars
echo 'JWT_SECRET="test-secret"' > packages/edge/.dev.vars
echo 'AUTH_ENABLED="true"' >> packages/edge/.dev.vars
echo 'LIMIT_ANONYMOUS="true"' >> packages/edge/.dev.vars
echo 'TURNSTILE_SITE_KEY="0x4AAAAAADry7cDPHW8cvNuC"' >> packages/edge/.dev.vars

# Start Vulnerable Demo API
echo "Starting Vulnerable Demo API..."
NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --port 8788 --cwd demo --inspector-port 9230 < /dev/null > demo.log 2>&1 &
disown

# Start Edge Coordinator
echo "Starting Edge Coordinator..."
NODE_OPTIONS="--max-old-space-size=4096" JWT_SECRET="test-secret" npx wrangler dev --cwd packages/edge --inspector-port 9231 < /dev/null > edge.log 2>&1 &
disown

# Start React Web Frontend
echo "Starting React Web Frontend..."
npm run dev:frontend < /dev/null > web.log 2>&1 &
disown

# Helper to check port
check_port() {
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z localhost "$1" >/dev/null 2>&1
}

# Wait for Coordinator to be up
echo "Waiting for Edge Coordinator on port 8787..."
for i in {1..15}; do
  if check_port 8787; then
    break
  fi
  sleep 1
done

if ! check_port 8787; then
  echo "✗ Error: Edge Coordinator failed to start."
  exit 1
fi

# Start Go Runner Agent
echo "Compiling and starting Go Runner..."
(cd packages/container && go build -o swazz-engine)
./packages/container/swazz-engine run-agent \
  --coordinator ws://127.0.0.1:8787/api/runners/connect \
  --token swazz_live_citoken1234567890 \
  --dangerous-no-container < /dev/null > packages/container/agent.log 2>&1 &
disown

echo "=== All services started successfully ==="
echo "- React Web Frontend: http://localhost:5173"
echo "- Edge Coordinator API: http://127.0.0.1:8787"
echo "- Vulnerable Demo API: http://127.0.0.1:8788"
