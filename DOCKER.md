# Docker Deployment Guide for Swazz

This guide explains how to run the Swazz application stack locally using Docker and Docker Compose.

## Quick Start (Development & Demo)

The easiest way to run the entire Swazz system locally in an offline, all-in-one setup is via Docker Compose.

```bash
# 1. Copy the example env file and set the shared runner token
cp .env.example .env
echo "SWAZZ_RUNNER_TOKEN=$(openssl rand -hex 32)" >> .env

# 2. Start all services
docker compose up --build

# 3. Access the application
# Web Dashboard: http://localhost:3000
# Coordinator API: http://localhost:8081/api
```

This Docker Compose setup starts three containers:
1. **`backend`**: The Cloudflare Edge Coordinator (Hono + local Wrangler emulator) on port 8081. It automatically runs SQLite migrations and accepts the shared runner that presents `SWAZZ_RUNNER_TOKEN` from your `.env` (compose refuses to start without it; generate one with `openssl rand -hex 32`). No credential is built into the image.
2. **`frontend`**: The React 19 web dashboard served via Nginx on port 3000. It proxies `/api` to the coordinator and includes WebSocket upgrade headers.
3. **`runner`**: The Go-based fuzzer runner agent. It runs headlessly, connects to the coordinator WebSocket endpoint (`ws://backend:8080/api/runners/connect`), and executes fuzzer runs.

## Manual Runner Agent Setup

If you prefer to run the runner agent in a standalone container or on your host, you can point it to the local compose coordinator:

```bash
# Pull the CLI / Runner container, pinned to an immutable commit SHA tag
docker pull ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA>

# Run the fuzzer agent on the host network, connecting to the compose coordinator:
docker run --rm -it ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA> run-agent \
  --coordinator ws://localhost:8081/api/runners/connect \
  --token "$SWAZZ_RUNNER_TOKEN" \
  --dangerous-no-container
```

## Security Considerations

### Runner Credentials
- **Shared runner** (takes every user's scans): connects with the operator token `SWAZZ_RUNNER_TOKEN`, which the coordinator reads as `SHARED_RUNNER_TOKEN` (at least 32 characters). Treat it like a password.
- **Personal runner**: connects with a user's own API key, or with a registered Ed25519 public key, and only ever receives that user's scans and spec imports.
- A shared runner sees every user's scan configuration, target credentials included, so run it only on infrastructure you operate.
- `SWAZZ_SHARED_RUNNERS_ALLOW_PRIVATE_IPS` (`SHARED_RUNNERS_ALLOW_PRIVATE_IPS` on the coordinator) decides whether a scan's `allow_private_ips` survives on the shared runner. It defaults to `false`. Set it to `true` in `.env` only when you are the coordinator's only user (for example, to fuzz a service on your own Docker network).

### CORS Configuration
- **Development**: `ALLOWED_ORIGIN=http://localhost` ✅
- **Production**: `ALLOWED_ORIGIN=https://your-domain.com` ✅
- **Never**: `ALLOWED_ORIGIN=*` ❌ (allows any domain to make requests)

### Private IP Fuzzing
Private ranges are blocked by default, and the setting is per scan rather than
per container:
- **Development**: `swazz-engine start --allow-private-ips=true`, or `"security": {"allow_private_ips": true}` in `swazz.config.json` ✅ (safe, isolated local network)
- **Production**: leave it unset ✅ (prevents fuzzer scans from reaching internal cloud IPs)

The `runner` compose service passes `--dangerous-no-container`, which lifts the
restriction for the local demo stack — drop that flag for anything production-like.

### Base Images
Docker images are configured for supply-chain security:
- `node:22-slim` (coordinator stage) / `node:20-alpine` (builder stage)
- `nginx:alpine` (web server)
- `gcr.io/distroless/static-debian12` (runner agent)

## Related Documentation

- [Swazz README](README.md)
- [Deployment Guidelines](docs/deployment.md)
- [Runner Agent Setup](packages/container/AGENT.md)
- [Environment Variables](docs/env_variables.md)
