# 🤖 swazz — Container Package Context (packages/container)

This file provides localized instructions and shortcuts for AI agents working within the `packages/container` Go module. For general repo rules, refer to [GEMINI.md](../../GEMINI.md).

## 🚀 Key Commands

All commands below should be executed with `Cwd` pointing to `packages/container` (relative to the workspace root).
Always prefix shell commands with `rtk` (e.g., `rtk go test ./...`).

### Build & Run
- **Build CLI**: `rtk go build -o swazz-engine main.go`
- **Run API Server**: `rtk go run main.go serve`
- **Run CLI Fuzzer**: `rtk go run main.go start --config swazz.config.json`

### Testing & Verification
- **Run All Tests**: `rtk go test ./...`
- **Run Package Tests**: `rtk go test ./internal/runner/...`
- **Run Single Test**: `rtk go test -run TestName ./internal/runner`
- **Run Tests with Race Detector**: `rtk go test -race ./...`
- **Check Coverage**:
  ```bash
  rtk go test -coverprofile=coverage.out ./...
  rtk go tool cover -html=coverage.out -o cover.html
  ```

### Performance & Benchmarking
- **Run Benchmarks**: `rtk go test -bench=. -benchmem ./internal/runner/...`
- **Run Specific Benchmark**: `rtk go test -bench=BenchmarkName -benchmem ./internal/runner/...`

### Code Quality & Security
- **Run Vet**: `rtk go vet ./...`
- **Run Security Scan**: `rtk go run github.com/securego/gosec/v2/cmd/gosec@latest ./...`

---

## 📁 Go Module Architecture

- [main.go](./main.go): Main entry point for CLI and web API server.
- [api/](./api/): Gin web framework routes and request/response handlers.
- [internal/runner/](./internal/runner/): Fuzzer execution engine, concurrency limiter, and BOLA replayer.
- [internal/generator/](./internal/generator/): Smart payload generator, dictionary builders, and wordlists.
- [internal/analyzer/](./internal/analyzer/): Security analyzers detecting XSS, SQLi, SSTI, and sensitive data leaks.

---

## 🧠 Go Coding Conventions

1. **Defensive Concurrency**:
   - Always pass `context.Context` to blocking/network calls.
   - Use [ConcurrencyLimiter](./internal/runner/limiter.go) to control concurrency. Always check errors from `limiter.Acquire(ctx)`.
2. **Zero-Allocation Focus**:
   - Reuse byte slices/buffers via `sync.Pool` on the hot path (e.g. `bufPool` in `runner.go`).
   - Pre-allocate maps and slices where the size is known.
3. **Strict Error Handling**:
   - Never discard errors (`_ = err` is forbidden unless explicitly justified).
   - Use `%w` when wrapping errors.
