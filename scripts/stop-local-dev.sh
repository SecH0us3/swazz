#!/usr/bin/env bash
# Copyright (c) 2026 Swazz Authors
# This file is part of Swazz
# Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
# See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details
#
# Stops everything scripts/start-local-dev.sh brings up.
#
# Killing by process name alone is not enough: `go run main.go` compiles the demo to a
# temporary binary and execs *that*, so `pkill -f "go run main.go"` reaps the wrapper
# while the gRPC and WebSocket demos keep holding ports 50051 and 50052. This script
# therefore finishes the job by port.

set -u

PORTS=(5173 8787 8788 50051 50052 9229 9230)

echo "=== Stopping Swazz dev environment ==="

echo "→ Signalling known processes..."
pkill -f wrangler >/dev/null 2>&1 || true
pkill -f vite >/dev/null 2>&1 || true
pkill -f swazz-engine >/dev/null 2>&1 || true
pkill -f "go run main.go" >/dev/null 2>&1 || true

sleep 2

echo "→ Releasing ports still held..."
for port in "${PORTS[@]}"; do
  pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
  [ -z "$pids" ] && continue
  # SIGTERM first, then SIGKILL for anything that ignores it.
  echo "$pids" | xargs kill >/dev/null 2>&1 || true
  sleep 1
  pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 >/dev/null 2>&1 || true
done

sleep 1

echo ""
busy=0
for port in "${PORTS[@]}"; do
  # Only listeners matter: a browser tab left open on 5173 shows up as a client
  # connection and must not be reported as a service that failed to stop.
  holder=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk -v p=":${port}$" '$9 ~ p {print $1; exit}')
  if [ -n "$holder" ]; then
    echo "  ⚠️  port ${port} still held by ${holder}"
    busy=1
  fi
done

if [ "$busy" -eq 0 ]; then
  echo "=== All services stopped. ==="
else
  echo "=== Some ports are still in use — see above. ==="
  exit 1
fi
