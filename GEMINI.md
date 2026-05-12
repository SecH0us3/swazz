# ⚡️ swazz — Gemini CLI Context

This file provides essential context for Gemini CLI to understand the `swazz` project structure, development workflows, and architecture.

## 🎯 Project Overview
**swazz** is a Smart API Fuzzer designed to identify crashes, logic flaws, and security vulnerabilities (like XSS or injection) by parsing Swagger/OpenAPI specifications and executing automated fuzzing runs.

### Core Architecture
The project is a hybrid repository using **npm workspaces** for the frontend and **Go modules** for the backend engine:
- **`packages/container`**: The core Go engine. Contains the HTTP API server (for the web dashboard), the CLI runner (`swazz-engine start`), the Smart Payload Generator, and output formatters.
- **`packages/web`**: A React 19 dashboard. Features a real-time Endpoint × Status heatmap, request inspector, and configuration management.
- **`packages/edge`**: Cloudflare integration (if applicable).

---

## 🛠 Tech Stack
- **Language**: Go (Backend), TypeScript/ESM (Frontend)
- **Frontend**: React 19, Vite, Vanilla CSS (CSS Variables)
- **Backend API**: Gin, standard `net/http`
- **Testing**: `go test` (Backend), Vitest (Frontend if any)

---

## 🚀 Key Commands

### Root Commands
- `npm install`: Install frontend dependencies.
- `npm run dev`: Starts the Go backend and Vite frontend concurrently.
- `npm run build`: Build the web dashboard.
- `npm run deploy:web`: Deploy the dashboard to Cloudflare Pages.

### Backend Commands (in `packages/container`)
- `go run main.go serve`: Start the HTTP API server.
- `go run main.go start --config <path>`: Run the fuzzer in CLI mode.
- `go test ./...`: Run all backend tests.

---

## 🧠 Development Conventions

### General
- **Go Best Practices**: The backend is written in Go. Ensure tests use `go test` and follow idiomatic Go conventions.
- **Web UI Types**: The web dashboard maintains its own `types.ts` to sync with the Go API JSON structures.

### Testing
- **Go Tests**: Always add unit tests in `packages/container/internal/...` for new fuzzing logic or generators. Tests should live alongside the files they test (e.g., `random_test.go` next to `random.go`).

### Styling (Web)
- **Vanilla CSS**: Avoid utility-first frameworks. Use `packages/web/src/index.css` for global variables and component-specific CSS files.
- **Theming**: Adhere to the established CSS variables (e.g., `--accent-light`, `--color-error`).

### CLI
- **Output Formats**: When adding findings or classifications, ensure they are reflected in `packages/container/internal/output/` (SARIF, JSON, HTML).

---

## 📁 Directory Structure
- `packages/container/main.go`: Entrypoint for both the server and CLI.
- `packages/container/internal/generator/`: Fuzz payload generation (`generator.go`) and static payloads (`payloads/`).
- `packages/container/internal/runner/`: The concurrent fuzz execution engine.
- `packages/container/api/`: Gin HTTP handlers for the web UI.
- `packages/web/src/components/`: React UI components (Dashboard, Heatmap, Inspector).

## Project Architecture & Refactoring Notes (Updated)
To maintain clean architecture, the application is strictly modular:
- **UI Components:** Kept as "dumb" as possible. Use `components/` for visual/layout logic (e.g., `MainWorkspace.tsx` manages internal application layout).
- **Complex UI State:** Handled by custom hooks in `packages/web/src/hooks/` (e.g., `useResizableLayout`, `useInspectorFilters`, `useToast`).
- **App Orchestration:** High-level app orchestration (like managing history or execution sessions) is done through domain-specific controller hooks (e.g., `useRunHistory`, `useFuzzSession`). Do not let `App.tsx` become a God Object.
- **Network & Business Logic (Frontend):** Separated into `packages/web/src/services/` (e.g., `swaggerService.ts`). Do not put `fetch` calls directly inside React components.
- **Payloads (Backend):** Static wordlists and payload definitions should be placed in `packages/container/internal/generator/payloads/`.
