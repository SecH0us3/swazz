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

The easiest way to start both the Go backend and the Vite frontend concurrently in development mode is:
```bash
npm run dev
```

### Docker (Recommended for Production)

We publish two Docker images to the GitHub Container Registry:
- **API Server & Web Dashboard**: [ghcr.io/sech0us3/swazz](https://github.com/SecH0us3/swazz/pkgs/container/swazz)
- **Headless CLI Fuzzer**: [ghcr.io/sech0us3/swazz-cli](https://github.com/SecH0us3/swazz/pkgs/container/swazz-cli)

For security reasons and to guarantee reproducibility, we **never use the `latest` tag**. Always use a specific commit SHA (replace `<COMMIT_SHA>` with the actual hash from our [Releases](https://github.com/SecH0us3/swazz/releases)).

#### Running the API Server (Web Dashboard)
```bash
docker pull ghcr.io/sech0us3/swazz:<COMMIT_SHA>
# The image exposes the backend service on container port 8080. Choose any host port you prefer:
docker run -p 8080:8080 ghcr.io/sech0us3/swazz:<COMMIT_SHA>
```

#### Running the Headless CLI
```bash
docker pull ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA>
# Run fuzzing directly (mount your config file using a volume):
docker run --rm -v $(pwd):/app ghcr.io/sech0us3/swazz-cli:<COMMIT_SHA> --config /app/swazz.config.json
```

If you use this repository's compose setup, host ports are parameterized via FRONTEND_PORT (default: 3000) and BACKEND_PORT (default: 8081). See DOCKER.md for details.

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

### Server Mode (Backend API Only)

To spin up just the API backend for the web dashboard:
```bash
cd packages/container
go run main.go serve
```

[← Back to Home](./index.md) | [Next: Usage & Configuration →](./usage.md)
