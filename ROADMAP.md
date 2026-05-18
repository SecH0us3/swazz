# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.

## 📝 Documentation & Onboarding

- [ ] **Task 1:** Create `SECURITY.md` to establish a formal vulnerability reporting process and security policy.
- [ ] **Task 2:** Add a comprehensive CI/CD integration guide (`docs/ci_cd.md`) with a working GitHub Actions example for SARIF reporting.
- [ ] **Task 3:** Add high-quality screenshots or GIFs of the Web Dashboard (Heatmap, Inspector) to the `README.md`.
- [ ] **Task 4:** Create `CONTRIBUTING.md` (and `docs/contributing.md`) with local setup instructions, code standards, and testing guides (`go test ./...`).

## ⚙️ Core Engine & Fuzzing Capabilities

- [ ] **Task 5:** Write a guide on creating custom rules, wordlists, and payload definitions (`docs/custom_payloads.md`).
- [ ] **Task 6:** Investigate and implement GraphQL schema parsing and fuzzing support.
- [ ] **Task 7:** Add support for importing Postman Collections alongside OpenAPI specs.

## 🎨 Web Dashboard Enhancements

- [ ] **Task 8:** Implement a "Replay Request" button in the Request Inspector to manually resend payloads to the target.
- [ ] **Task 9:** Add export functionality in the Web UI to download the HTML/JSON report directly from the browser.
