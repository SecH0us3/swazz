# ⚡️ swazz — Gemini CLI Context

This file provides essential context for Gemini CLI to understand the `swazz` project structure, development workflows, and architecture.

## 🎯 Project Overview
**swazz** is a Smart API Fuzzer designed to identify crashes, logic flaws, and security vulnerabilities (like XSS or injection) by parsing Swagger/OpenAPI specifications and executing automated fuzzing runs.

### Core Architecture
The project is a TypeScript monorepo using **npm workspaces**:
- **`@swazz/core`**: The engine. Handles Swagger parsing, smart payload generation, and the parallel `FuzzRunner`. Framework-agnostic (runs in Browser/Node).
- **`@swazz/web`**: A React 19 dashboard. Features a real-time Endpoint × Status heatmap, request inspector, and configuration management.
- **`@swazz/cli`**: A Node.js CLI for automated scanning and CI/CD integration. Supports SARIF, JSON, and HTML output.
- **`@swazz/worker`**: A Cloudflare Worker proxy using **Hono**. Used by the web dashboard to bypass CORS when fuzzing remote APIs.

---

## 🛠 Tech Stack
- **Language**: TypeScript (ESM)
- **Monorepo**: npm workspaces
- **Frontend**: React 19, Vite, Vanilla CSS (CSS Variables)
- **Proxy/Worker**: Hono, Wrangler
- **Testing**: Vitest
- **API**: Native `fetch` (standardized across environments)

---

## 🚀 Key Commands

### Root Commands
- `npm install`: Install all dependencies.
- `npm run dev`: Start the web dashboard development server.
- `npm run build`: Build core and web packages.
- `npm run test`: Run tests for the core engine.
- `npm run deploy:web`: Deploy the dashboard to Cloudflare Pages.
- `npm run deploy:worker`: Deploy the proxy to Cloudflare Workers.

### Package-Specific Commands
- **Core**: `npm run test` (Vitest)
- **Web**: `npm run dev` (Vite), `npm run build`, `npm run deploy`
- **CLI**: `npm run start -- --config <path>` (using `tsx`)
- **Worker**: `npm run dev` (Wrangler), `npm run deploy`

---

## 🧠 Development Conventions

### General
- **TypeScript & ESM**: Use strict TypeScript and ES Modules across all packages.
- **Surgical Updates**: When modifying `core`, ensure changes remain compatible with both `cli` (Node) and `web` (Browser).

### Testing
- **Vitest**: Always add unit tests in `packages/core/tests` for new fuzzing logic or generators.
- **Mocking**: Use `vitest` mocks for network requests (see `packages/core/tests/runner.test.ts` for patterns).

### Styling (Web)
- **Vanilla CSS**: Avoid utility-first frameworks. Use `packages/web/src/index.css` for global variables and component-specific CSS files.
- **Theming**: Adhere to the established CSS variables (e.g., `--accent-light`, `--color-error`).

### CLI
- **Output Formats**: When adding findings or classifications, ensure they are reflected in `sarif.ts`, `json.ts`, and `html.ts` output generators.

---

## 📁 Directory Structure
- `packages/core/src/`: Fuzzing engine (`runner.ts`), payload generation (`generator.ts`), and types.
- `packages/web/src/components/`: React UI components (Dashboard, Heatmap, Inspector).
- `packages/cli/src/`: CLI implementation, result classifiers, and output formatters.
- `packages/worker/src/`: Cloudflare Worker proxy implementation.
- `swazz.config.example.json`: Template for CLI configuration.
