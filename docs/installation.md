---
title: Installation
---

# Installation Guide 🛠

Swazz is built using **Go** for the backend engine and **Node.js (TypeScript/React)** for the frontend web dashboard. To get started, you'll need both environments configured.

## Prerequisites

Before installing, ensure you have the following installed on your system:
- **Go** (version 1.21 or later)
- **Node.js** (version 18 or later)
- **npm** (Node Package Manager)

## Getting Started (Without Docker)

If you prefer to run everything locally without containers, follow these steps:

1. **Clone the Repository**

   Clone the Swazz repository from GitHub to your local machine:
   ```bash
   git clone https://github.com/your-org/swazz.git
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

### Docker & Compose (Recommended for Production)

We package and run the Swazz application components via Docker and Docker Compose. We publish the following container image:
- **Headless CLI Fuzzer / Scanner**: [ghcr.io/sech0us3/swazz-cli](https://github.com/SecH0us3/swazz/pkgs/container/swazz-cli)

For detailed instructions on running the entire Web UI, coordinator, and runner agent locally, please see the [Docker Deployment Guide](https://github.com/SecH0us3/swazz/blob/master/DOCKER.md).

#### Running the Headless CLI
```bash
docker pull ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA>
# Run fuzzing directly (mount your config file using a volume):
docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA> --config /app/swazz.config.json
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

### Runner Agent Mode (Web Dashboard Backend)

The web dashboard is served by the Cloudflare edge coordinator; the Go engine
joins it as a runner agent over WebSocket rather than exposing its own API
server:
```bash
cd packages/container
go run main.go run-agent --coordinator ws://127.0.0.1:8787/api/runners/connect --token <runner-token>
```

To bring up the whole local stack (coordinator, dashboard, demo targets and a
connected runner agent) in one step, run `bash scripts/start-local-dev.sh` from
the repository root instead.

[← Back to Home](./index.md) | [Next: Usage & Configuration →](./usage.md)
