# Contributing to Swazz 🚀

Thank you for your interest in contributing to **Swazz**! We welcome contributions of all kinds, including bug fixes, new features, documentation improvements, and feedback.

This guide outlines the local development setup, coding standards, and testing workflows to help you get started.

---

## 🛠 Prerequisites

Ensure you have the following installed on your local machine:
- **Go** (version 1.21 or later)
- **Node.js** (version 18 or later)
- **npm** (Node Package Manager)

---

## 💻 Local Setup

Follow these steps to set up your development environment:

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/SecH0us3/swazz.git
   cd swazz
   ```

2. **Install Frontend Dependencies:**
   Install the necessary Node.js packages for the monorepo workspaces:
   ```bash
   npm install
   ```

3. **Symlink Development Toolkit (Optional):**
   If you are pair-programming with the Antigravity AI assistant, run the one-time developer setup script to symlink the toolkit plugin:
   ```bash
   bash scripts/setup-dev.sh
   ```

4. **Run the Development Server:**
   You can start both the Go backend (reloaded automatically via `air`) and the Vite frontend concurrently:
   ```bash
   npm run dev
   ```
   *   The Go backend will run on `http://localhost:8080`.
   *   The React frontend dashboard will open on `http://localhost:5173`.

---

## 📂 Project Architecture

Swazz is structured as a monorepo containing multiple packages:
- **`packages/container`**: The core Go fuzzing engine, HTTP API server, and CLI tool.
- **`packages/web`**: The React 19 web dashboard built using TypeScript and Vite.
- **`packages/edge`**: Cloudflare Workers integration.

---

## 🧠 Code Standards

To keep the codebase maintainable, secure, and clean, please adhere to the following standards:

### 1. Go Backend (packages/container)
- **Idiomatic Go**: Code should follow standard Go conventions. Format your code using `gofmt` and verify code health using `go vet`.
- **Unit Testing**: Every new logic module or payload generator must have unit tests. Tests must be placed alongside the implementation file (e.g., `generator_test.go` next to `generator.go`).
- **Command-line Interface**: Output format additions or classifications must be reflected in `packages/container/internal/output/` (supporting SARIF, JSON, and HTML).

### 2. TypeScript / React Frontend (packages/web)
- **Dumb Components**: UI components inside `src/components/` must remain as "dumb" as possible, focusing purely on layout and visual presentation.
- **Zustand Global State**: The application uses **Zustand** for global UI and Fuzzing Session state (`src/store/appStore.ts`). Use selector-based rendering (e.g. `useAppStore(state => state.activeTab)`) instead of React Context or prop-drilling to handle high-frequency updates from Server-Sent Events without lagging the UI.
- **Hooks for Complex State**: Business logic, resizes, and multi-component UI states must be encapsulated inside custom hooks (`src/hooks/`). These hooks should dispatch updates directly to the Zustand store when interacting with global state.
- **Services for Network Logic**: Network fetch calls and API communications must be isolated inside `src/services/` (e.g. `swaggerService.ts`). Do not put fetch logic directly in React components.
- **Vanilla CSS**: We use Vanilla CSS for styling. Global variables and standard theme variables (e.g., `--accent-light`, `--color-error`) are located in `src/index.css`. **Avoid using TailwindCSS** or other utility frameworks unless explicitly required.
- **Type Syncing**: Ensure frontend type definitions in `src/types.ts` are strictly synced with Go JSON response structures.

### 3. Supply Chain Security 🛡
- **Strict Version Pinning**: To prevent supply chain attacks, always pin third-party dependencies, Docker base images, external scripts, and GitHub Actions to specific commit SHAs or verifiable hashes. Do not use mutable tags like `latest`, `master`, or `v1`.

---

## 🧪 Testing Guide

We expect all contributions that change code behavior to include tests.

### Backend Go Tests
Run the Go unit tests inside the backend directory:
```bash
cd packages/container
go test -timeout 30s -cpu 1,2 ./...
```
You can also run the backend test script:
```bash
# If using the developer toolkit
./.agents/plugins/swazz-toolkit/skills/swazz-workflows/scripts/test-backend.sh
```

### Frontend React Tests
Run the Vitest suite in the frontend workspace:
```bash
npm run test --workspace=packages/web
```
