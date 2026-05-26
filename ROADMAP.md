# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.

## 📝 Documentation & Onboarding

- [x] **Task 1:** Create `SECURITY.md` to establish a formal vulnerability reporting process and security policy.
- [/] **Task 2:** Add a comprehensive CI/CD integration guide (`docs/ci_cd.md`) with a working GitHub Actions example for SARIF reporting.
- [ ] **Task 3:** Add high-quality screenshots or GIFs of the Web Dashboard (Heatmap, Inspector) to the `README.md`. *(Depends on: Task 12)*
- [x] **Task 4:** Create `CONTRIBUTING.md` (and `docs/contributing.md`) with local setup instructions, code standards, and testing guides (`go test ./...`).
- [x] **Task 10:** Upgrade the documentation site to a modern theme with built-in search and interactive code examples (e.g., using "Just the Docs" Jekyll theme or migrating to Docusaurus/VitePress).
- [ ] **Task 11:** Design and add an Open Graph social preview image (1280x640) for the GitHub repository and documentation site.
- [x] **Task 12:** Create a local "Vulnerable Demo API" (e.g., in a `demo/` folder) so users can immediately test Swazz capabilities out of the box.

## ⚙️ Core Engine & Fuzzing Capabilities

- [x] **Task 5:** Implement dynamic custom wordlists loading from `.txt` files via `swazz.config.json` (and update the corresponding documentation).
- [x] **Task 6:** Investigate and implement GraphQL schema parsing and fuzzing support.
- [x] **Task 17:** Add support for SOAP (WSDL) protocol fuzzing and XML payload generation.
- [x] **Task 7:** Add support for importing Postman Collections alongside OpenAPI specs. *(Depends on: Task 6)*
- [x] **Task 18:** Implement a configurable Private IP / Localhost filter (SSRF Protection) for remote/cloud deployments.
  - **Design Goal:** Protect centralized cloud instances (e.g., hosted on Cloudflare Workers/Pages or cloud VMs) from being abused to scan internal corporate networks, cloud metadata endpoints (`169.254.169.254`), or loopback interfaces, while preserving the ability for local CLI and self-hosted users to scan local development APIs (`localhost`).
  - **Implementation Details:**
    - Introduce `security.allow_private_ips` in `swazz.config.json` and a CLI flag `--allow-private-ips`.
    - At runtime, default to `false` in server mode (`serve`) unless overridden by configuration or environment variable `SWAZZ_ALLOW_PRIVATE_IPS=true`. Default to `true` in CLI mode (`start`).
    - Wrap the HTTP transport dialer in [detect.go](file:///Users/alex/src/swazz/packages/container/internal/swagger/detect.go) and [runner.go](file:///Users/alex/src/swazz/packages/container/internal/runner/runner.go) with custom IP verification logic. Resolve hostnames to IPs and block RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), and link-local (`169.254.0.0/16`) ranges when the filter is active.
    - Return a standardized error `request blocked by SSRF policy` on violation.

## 🎨 Web Dashboard Enhancements

- [x] **Task 8:** Add export functionality in the Web UI to download the HTML/JSON report directly from the browser.
- [x] **Task 20:** Decouple React state in the Web Dashboard by migrating global state to a React Context or Zustand store.
  - **Design Goal:** Eliminate rendering lag and interface blocking in the browser when streaming high-concurrency fuzzing runs, especially on lower-end local developer machines.
  - **Implementation Details:**
    - Refactor [App.tsx](file:///Users/alex/src/swazz/packages/web/src/App.tsx) to move live session state (`logs`, `heatmapStats`, `activeTab`, `liveCount`, `isRunning`, `isPaused`) out of the root element into a Zustand store or optimized React Context.
    - Implement selector-based rendering so that fast-updating values (such as logs or request counters) only trigger re-renders in their respective sub-components rather than the entire workspace layout (sidebar, header, dictionaries, etc.).
- [ ] **Task 21:** Add visual mutation highlighting (request diff-view) to the request Inspector.
  - **Design Goal:** Allow developers and security auditors to instantly spot exactly what parameters, headers, or request body keys were modified by the generator during a specific fuzz iteration.
  - **Implementation Details:**
    - In `RequestDetail.tsx`, render a visual diff view comparing the original API request schema/template against the generated fuzzed request payload.
    - Highlight mutated query values in yellow, added structure keys in green, and injected payloads/vulnerability inputs in red.
    - Add a toggle switch in the Inspector pane to flip between "Raw Fuzzed Request" and "Mutation Diff".

## 🛡 Internal Security & Infrastructure

- [x] **Task 13:** Harden the Dockerfile (multi-stage build, distroless base, non-root user) and integrate Trivy image vulnerability scanning into GitHub Actions.
- [x] **Task 14:** Setup Static Application Security Testing (SAST) for Swazz itself using `gosec` (Go Security Checker) and GitHub CodeQL. *(Depends on: Task 2)*
- [x] **Task 15:** Configure Dependabot or Renovate to automatically update Go modules and npm dependencies.
- [ ] **Task 22:** Implement E2E browser automation tests using Playwright.
  - **Design Goal:** Ensure full integration verification between the Vite frontend SPA, Go REST API server, SSE engine, and IndexedDB local client storage during continuous integration builds.
  - **Implementation Details:**
    - Create a suite of TypeScript Playwright tests under a new directory `tests/e2e/`.
    - Configure GitHub Actions to spin up the local Vulnerable Demo API, start `swazz-engine serve`, build/run the React application, automate the browser to trigger a demo fuzzing run, and assert that findings are properly populated on the heatmap grid and can be exported.
- [ ] **Task 23:** Pin all GitHub Actions in `.github/workflows/` to specific commit SHAs (commit-level pinning).
  - **Design Goal:** Hardening CI/CD security against potential compromised third-party GitHub Action repository tags (Supply Chain protection).
  - **Implementation Details:**
    - Replace version tags (e.g. `actions/checkout@v4`, `actions/setup-go@v5`) in `.github/workflows/` with exact 40-character commit hashes.
    - Document human-readable version equivalents as line comments above each pinned step (e.g. `# v4.1.2`).
    - Configure Dependabot to support and automatically update commit-pinned action dependencies.

## ⚡️ Performance & Architecture

- [x] **Task 16:** Replace the blocking select-timeout SSE Broadcast implementation with a non-blocking lock-free concurrent collection or ring-buffer pattern (similar to LMAX Disruptor or a lock-free MPSC ring-buffer queue).
- [x] **Task 19:** Reduce Mutex contention in the Go runner by refactoring statistical aggregation to run off-thread via channels/batching.
  - **Design Goal:** Unlock maximum hardware utilization during local CLI runs. Under high concurrency configurations, worker threads must not get blocked waiting for the single global stats mutex.
  - **Implementation Details:**
    - Modify [runner.go](file:///Users/alex/src/swazz/packages/container/internal/runner/runner.go) and [stats.go](file:///Users/alex/src/swazz/packages/container/internal/runner/stats.go) to remove immediate calls to `r.mu.Lock()` from request completion hooks.
    - Implement a buffered stats channel `statsChan chan *swagger.FuzzResult`. Workers will send results asynchronously.
    - Run an internal background goroutine to consume results from `statsChan`, accumulate statistics locally in-memory, and publish aggregated updates to the UI/SSE emitter at a fixed interval (e.g. every 150ms).


