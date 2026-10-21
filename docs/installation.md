---
title: Installation
---

# Installation Guide 🛠

There are three ways to use Swazz — pick the one that matches what you need:

| You want to… | Do this | Needs |
| :--- | :--- | :--- |
| Try it in the browser | Sign up at [swazz.secmy.app](https://swazz.secmy.app) and connect a runner from **Project Settings → Active Runners** | Docker, for your own runner |
| Scan from a terminal or CI | Download a binary from [Releases](https://github.com/SecH0us3/swazz/releases) or use the `ghcr.io/sech0us3/swazz-cli` image ([CLI Mode](#cli-mode-backend-only)) | nothing else |
| Self-host the whole stack | Follow this page, then [Deployment](./deployment.md) for production | Go, Node.js |

The dashboard never sends fuzz traffic itself: every scan runs on a **runner agent** — the Go engine in `run-agent` mode — which connects out to the coordinator over WebSocket. Scans go to your own runner first; only if you have no runner connected, no private runner key registered and shared runners are not disabled for the project, they fall back to an operator-run shared runner when one is online. To scan internal or `localhost` targets, connect your own runner.

## Prerequisites

To build from source you need:
- **Go** 1.26 or later (see `packages/container/go.mod`)
- **Node.js** 22.12 or later (Vite 8 and Wrangler 4 need it; CI uses Node 25) with **npm**

## Getting Started (Without Docker)

If you prefer to run everything locally without containers, follow these steps:

1. **Clone the Repository**

   Clone the Swazz repository from GitHub to your local machine:
   ```bash
   git clone https://github.com/SecH0us3/swazz.git
   cd swazz
   ```

2. **Install Frontend Dependencies**

   Navigate to the root directory and install all npm dependencies (for the web dashboard):
   ```bash
   npm install
   ```

3. **Build the Web Dashboard (Optional)**

   If you plan to run the production version or deploy it, build the frontend first:
   ```bash
   npm run build
   ```
   This will bundle the React frontend located in `packages/web`.

## Running the Application

### Run Everything At Once (No Docker)

The recommended way to start the entire local development environment—including the Web UI dashboard, Cloudflare Worker coordinator, the vulnerable demo API, and compiling + starting the Go runner agent concurrently—is to run the interactive startup script:
```bash
./start-dev.sh
```
This script handles starting all components in the background, redirects their logs, and shuts them all down cleanly when you press `Ctrl+C`.

If you would rather have the stack keep running after the command returns — handy when you
want the terminal back — use the background variant instead. It brings up the same
services, plus the vulnerable HTTP (8788), gRPC (50051) and WebSocket (50052) demo targets:
```bash
bash scripts/start-local-dev.sh   # start, returns immediately
bash scripts/stop-local-dev.sh    # stop everything it started
```
Stop it with that script rather than `pkill`: `go run` execs a compiled temporary binary,
so killing by process name reaps the wrapper while the gRPC and WebSocket demos keep
holding their ports.

Alternatively, if you only want to start the frontend Web UI and edge coordinator development servers (without compiling or running the runner agent), you can run:
```bash
npm run dev
```

### Docker & Compose

We publish two container images (tagged with the commit SHA, plus `latest` for releases):
- **Headless CLI Fuzzer / Scanner**: [ghcr.io/sech0us3/swazz-cli](https://github.com/SecH0us3/swazz/pkgs/container/swazz-cli)
- **Runner Agent**: [ghcr.io/sech0us3/swazz](https://github.com/SecH0us3/swazz/pkgs/container/swazz) — connects out to the coordinator over WebSocket and listens on no port.

For production deployments (Cloudflare coordinator, isolated runners) see the [Deployment Guide](./deployment.md); for Kubernetes see [Kubernetes](./kubernetes.md).

For detailed instructions on running the entire Web UI, coordinator, and runner agent locally, please see the [Docker Deployment Guide](https://github.com/SecH0us3/swazz/blob/master/DOCKER.md).

#### Running the Headless CLI
```bash
docker pull ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA>
# Run fuzzing directly (mount your config file using a volume):
docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA> start --config /app/swazz.config.json
```

If you use this repository's Compose setup, you can launch the complete dashboard, Cloudflare coordinator, and runner agent stack with a single command:
```bash
docker compose up --build
```
See [DOCKER.md](https://github.com/SecH0us3/swazz/blob/master/DOCKER.md) for configuration details.

### CLI Mode (Backend Only)

If you just want to run the core Go engine from the command line without the web interface:

1. Navigate to the backend directory:
   ```bash
   cd packages/container
   ```
2. Start the fuzzer with a config file:
   ```bash
   go run main.go start --config /path/to/config.json
   ```

### Runner Agent Mode (Web Dashboard Backend) {#runner-agent}

The web dashboard is served by the Cloudflare edge coordinator; the Go engine
joins it as a runner agent over WebSocket rather than exposing its own API
server:
```bash
cd packages/container
go run main.go run-agent --coordinator ws://127.0.0.1:8787/api/runners/connect --token <runner-token>
```

`<runner-token>` is a project API key or a runner token; the dashboard prints the
exact command (with a pre-filled token, or a signing-key variant) under
**Project Settings → Active Runners**. For hardening the runner host see
[Runner Sandboxing](./runner_sandboxing_guide.md).

To bring up the whole local stack (coordinator, dashboard, demo targets and a
connected runner agent) in one step, run `bash scripts/start-local-dev.sh` from
the repository root instead.

[← Back to Home](./index.md) | [Next: Usage & Configuration →](./usage.md)
