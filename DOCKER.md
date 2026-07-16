# Docker Deployment Guide for Swazz

This guide explains how to run the Swazz application stack locally using Docker and Docker Compose.

## Quick Start (Development & Demo)

The easiest way to run the entire Swazz system locally in an offline, all-in-one setup is via Docker Compose.

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Start all services
docker compose up --build

# 3. Access the application
# Web Dashboard: http://localhost:3000
# Coordinator API: http://localhost:8081/api
```

This Docker Compose setup starts three containers:
1. **`backend`**: The Cloudflare Edge Coordinator (Hono + local Wrangler emulator) on port 8081. It automatically runs SQLite migrations and seeds a default CI user with API Key `swazz_live_citoken1234567890` for runner connections.
2. **`frontend`**: The React 19 web dashboard served via Nginx on port 3000. It proxies `/api` to the coordinator and includes WebSocket upgrade headers.
3. **`runner`**: The Go-based fuzzer runner agent. It runs headlessly, connects to the coordinator WebSocket endpoint (`ws://backend:8080/api/runners/connect`), and executes fuzzer runs.

## Manual Runner Agent Setup

If you prefer to run the runner agent in a standalone container or on your host, you can point it to the local compose coordinator:

```bash
# Pull the latest CLI / Runner container
docker pull ghcr.io/sech0us3/swazz-cli:latest

# Run the fuzzer agent on the host network, connecting to the compose coordinator:
docker run --rm -it ghcr.io/sech0us3/swazz-cli:latest run-agent \
  --coordinator ws://localhost:8081/api/runners/connect \
  --token swazz_live_citoken1234567890 \
  --dangerous-no-container
```

## Security Considerations

### CORS Configuration
- **Development**: `ALLOWED_ORIGIN=http://localhost` ✅
- **Production**: `ALLOWED_ORIGIN=https://your-domain.com` ✅
- **Never**: `ALLOWED_ORIGIN=*` ❌ (allows any domain to make requests)

### Private IP Fuzzing
- **Development**: `SWAZZ_ALLOW_PRIVATE_IPS=true` ✅ (safe, isolated local network)
- **Production**: `SWAZZ_ALLOW_PRIVATE_IPS=false` ✅ (prevents fuzzer scans from reaching internal cloud IPs)

### Base Images
Docker images are configured for supply-chain security:
- `node:22-slim` (coordinator stage) / `node:20-alpine` (builder stage)
- `nginx:alpine` (web server)
- `gcr.io/distroless/static-debian12` (runner agent)

## Related Documentation

- [Swazz README](README.md)
- [Edge Coordinator Setup](packages/edge/README.md)
- [Runner Agent Setup](packages/container/AGENT.md)
- [Frontend Setup](packages/web/README.md)
