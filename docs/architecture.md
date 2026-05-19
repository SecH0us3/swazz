---
layout: default
title: Architecture
---

# Architecture & Internals 🧠

Swazz uses a modular **hybrid architecture** that separates the high-performance fuzzing engine from the user interface.

## Repository Structure

The project is structured into workspaces:

### 1. `packages/container` (Backend Engine)
Written in Go, this is the core of Swazz. It handles all heavy lifting, multi-threading, and networking.
- `main.go`: The main entrypoint. Handles commands for both CLI (`start`) and API (`serve`).
- `internal/generator/`: Contains logic for analyzing OpenAPI specs and generating smart payloads (e.g., UUIDs, strings, large boundaries). Static payloads are kept in `internal/generator/payloads/`.
- `internal/runner/`: The concurrent execution engine. Manages rate limits, parallel execution, and HTTP clients.
- `internal/output/`: Analyzes HTTP responses and outputs them into specific formats (SARIF, JSON).
- `api/`: Gin HTTP handlers that power the Web Dashboard's backend.

### 2. `packages/web` (Frontend UI)
A React 19 Single Page Application built with Vite.
- **Strict UI Separation**: Components in `src/components/` are kept "dumb" focusing only on layout. Complex application states are managed via hooks in `src/hooks/`.
- **Vanilla CSS**: We strictly use Vanilla CSS with CSS variables (`src/index.css`) rather than utility frameworks like Tailwind. This maintains a lean, unified design language with a premium dark-theme aesthetic.
- **Service Layer**: All external API calls to the Go backend are encapsulated in `src/services/` (e.g., `swaggerService.ts`).

### 3. `packages/edge` (Optional)
Reserved for Cloudflare Workers integration and edge-deployments.

## Smart Fuzzing Workflow

1. **Parse**: The engine loads the OpenAPI JSON/YAML spec.
2. **Generate**: For each endpoint and parameter, the Generator creates standard requests and boundary/malicious requests based on the types (String, Int, UUID array, etc.).
3. **Execute**: The Runner executes these requests concurrently against the target API.
4. **Analyze**: The response analyzer checks for unexpected status codes (e.g., 500 Internal Server Error) or data leaks, reporting them back via the CLI or live via SSE to the React Dashboard.

[← Back to Usage](./usage.html)
