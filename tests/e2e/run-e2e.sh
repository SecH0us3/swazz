#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Set working directory to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

echo "=== Swazz E2E Automated Test Runner ==="
echo "Project Root: $ROOT_DIR"

# Create dummy wordlist folder and file for E2E tests
mkdir -p wordlists
echo "dummy-xss-payload" > wordlists/xss-custom.txt

# Keep track of PIDs we start to kill them on exit
PIDS=()
cleanup() {
  if [ ${#PIDS[@]} -ne 0 ]; then
    echo -e "\n=== Cleaning up background services (PIDs: ${PIDS[*]}) ==="
    for pid in "${PIDS[@]}"; do
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    done
  fi
  # Clean up dummy wordlist
  rm -rf wordlists
}
# Trap exit signals to ensure cleanup is run
trap cleanup EXIT

# Helper function to check if port is in use
check_port() {
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z localhost "$1" >/dev/null 2>&1
}

# Helper function to wait dynamically for a port to open
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

# Pre-cleanup: kill any zombie processes on the test ports
echo "→ Stopping any existing services on ports 8788, 8787, 5173..."
lsof -ti :8788,8787,5173 | xargs kill -9 2>/dev/null || true
pkill -f "swazz-engine" || true
sleep 1

# 1. Start Vulnerable Demo API (Port 8788)
if check_port 8788; then
  echo "✓ Vulnerable Demo API is already running on port 8788."
else
  echo "→ Starting Vulnerable Demo API..."
  NODE_OPTIONS="--max-old-space-size=4096" npx wrangler dev --port 8788 --cwd demo > demo.log 2>&1 &
  PIDS+=($!)
  wait_for_port 8788 "Vulnerable Demo API"
fi

# 2. Start Edge Coordinator (Port 8787)
if check_port 8787; then
  echo "✓ Edge Coordinator is already running on port 8787."
else
  echo "→ Starting Edge Coordinator..."
  NODE_OPTIONS="--max-old-space-size=4096" JWT_SECRET="local-secret-key-123456" npx wrangler dev --cwd packages/edge > edge.log 2>&1 &
  PIDS+=($!)
  wait_for_port 8787 "Edge Coordinator"
fi

# 3. Start React Web Frontend (Port 5173)
if check_port 5173; then
  echo "✓ React Web Frontend is already running on port 5173."
else
  echo "→ Starting React Web Frontend..."
  npm run dev:frontend > web.log 2>&1 &
  PIDS+=($!)
  wait_for_port 5173 "React Web Frontend"
fi


# 4. Build and start Go Runner Agent
echo "→ Compiling Go Runner Agent..."
(cd packages/container && go build -o swazz-engine)

# Check if agent is already running (simple ps check)
if pgrep -f "swazz-engine run-agent" >/dev/null; then
  echo "✓ Go Runner Agent is already running."
else
  echo "→ Starting Go Runner Agent..."
  ./packages/container/swazz-engine run-agent \
    --coordinator ws://127.0.0.1:8787/api/runners/connect \
    --token swazz_live_citoken1234567890 \
    --dangerous-no-container > packages/container/agent.log 2>&1 &
  PIDS+=($!)
  
  # Wait for agent to start up
  for i in {1..5}; do
    if pgrep -f "swazz-engine run-agent" >/dev/null; then
      break
    fi
    sleep 1
  done
fi

# Double check services are up
echo "Checking service connectivity..."
for port in 8788 8787 5173; do
  if ! check_port "$port"; then
    echo "✗ Error: Service on port $port is not accessible."
    exit 1
  fi
done

# 5. Run Playwright E2E Tests
echo "→ Running Playwright E2E tests..."
npx playwright test "$@"

echo "=== All Tests Passed Successfully! ==="
