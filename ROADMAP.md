# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.

## 📝 Documentation & Onboarding

- [x] **Task 1:** Create `SECURITY.md` to establish a formal vulnerability reporting process and security policy.
- [/] **Task 2:** Add a comprehensive CI/CD integration guide (`docs/ci_cd.md`) with a working GitHub Actions example for SARIF reporting.
- [ ] **Task 3:** Add high-quality screenshots or GIFs of the Web Dashboard (Heatmap, Inspector) to the `README.md`. *(Depends on: Task 12)*
- [ ] **Task 4:** Create `CONTRIBUTING.md` (and `docs/contributing.md`) with local setup instructions, code standards, and testing guides (`go test ./...`).
- [x] **Task 10:** Upgrade the documentation site to a modern theme with built-in search and interactive code examples (e.g., using "Just the Docs" Jekyll theme or migrating to Docusaurus/VitePress).
- [ ] **Task 11:** Design and add an Open Graph social preview image (1280x640) for the GitHub repository and documentation site.
- [x] **Task 12:** Create a local "Vulnerable Demo API" (e.g., in a `demo/` folder) so users can immediately test Swazz capabilities out of the box.

## ⚙️ Core Engine & Fuzzing Capabilities

- [x] **Task 5:** Implement dynamic custom wordlists loading from `.txt` files via `swazz.config.json` (and update the corresponding documentation).
- [x] **Task 6:** Investigate and implement GraphQL schema parsing and fuzzing support.
- [ ] **Task 7:** Add support for importing Postman Collections alongside OpenAPI specs. *(Depends on: Task 6)*

## 🎨 Web Dashboard Enhancements

- [x] **Task 8:** Add export functionality in the Web UI to download the HTML/JSON report directly from the browser.

## 🛡 Internal Security & Infrastructure

- [x] **Task 13:** Harden the Dockerfile (multi-stage build, distroless base, non-root user) and integrate Trivy image vulnerability scanning into GitHub Actions.
- [x] **Task 14:** Setup Static Application Security Testing (SAST) for Swazz itself using `gosec` (Go Security Checker) and GitHub CodeQL. *(Depends on: Task 2)*
- [x] **Task 15:** Configure Dependabot or Renovate to automatically update Go modules and npm dependencies.

## ⚡️ Performance & Architecture

- [x] **Task 16:** Replace the blocking select-timeout SSE Broadcast implementation with a non-blocking lock-free concurrent collection or ring-buffer pattern (similar to LMAX Disruptor or a lock-free MPSC ring-buffer queue).

