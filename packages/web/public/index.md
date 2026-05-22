# Swazz: Smart API Fuzzer ⚡️

Swazz is an advanced, high-performance Smart API Fuzzer designed to identify crashes, logic flaws, and security vulnerabilities (such as XSS, SQL injection, and boundary bypassing) by automatically parsing your Swagger/OpenAPI specifications.

## 🌟 Key Features

- **Smart Payload Generation**: Automatically generates context-aware payloads based on API schema definitions (e.g., proper UUIDs, massive strings, malicious payloads).
- **Hybrid Architecture**: Fast Go-based execution engine (`packages/container`) paired with a modern React 19 web dashboard (`packages/web`).
- **Interactive Web UI**: Features a real-time Endpoint × Status heatmap, dynamic request inspector, and easy configuration management.
- **Robust CLI**: Run headless CI/CD integrations with high concurrency and detailed reporting.
- **Cloudflare Ready**: Built-in support for Edge deployment.

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
*Find 500 errors before your users do. Smart API fuzzing with boundary, malicious, and random payload profiles.*
