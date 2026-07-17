---
name: swazz-workflows
description: Core workflows and command instructions for the swazz project.
---
# Swazz Workflows & Tooling

This skill defines how to work with the `swazz` project.

## 🛠 Deterministic Helper Scripts
- Run `npm run dev` to spin up the local dev environment (Vite frontend + Cloudflare edge coordinator).
- Run `scripts/test-backend.sh` to execute the Go backend unit tests, compiler checks (`go vet`), and SAST security scans (`gosec`).

## 🔍 Code Navigation & RAG Search
- **MANDATORY RAG tools usage**: You MUST use the MCP tools `swazz_search_code` (for semantic and keyword search) and `swazz_get_file_context` (for structured outlines of files) as your primary methods for code navigation and search. Do not use generic grep search or view full files using `view_file` unless the RAG tools are not applicable, have failed, or you explicitly need to read the entire file. This keeps token usage optimal.

## 🔄 Development Architecture
- **Backend**: `packages/container/`. Contains fuzzing logic.
- **Frontend**: `packages/web/`. Contains React 19 UI. Use `modern-web-guidance`.

## 🤖 Autonomous Execution Flow (Human-in-the-Loop)
When handling a Task N, delegate to specialized subagents:
- **`backend_engineer`**: For Go code. Must run Go benchmarks (`go test -bench=. -run=^$ ./...` in `packages/container`) on performance tasks.
- **`frontend_engineer`**: For React UI tasks.
- **`qa_tester`**: For writing E2E tests and validating Fuzzer benchmarks.

**Universal Workflow:**
1. Create a git branch `feature/task-N`. Find the task on the GitHub Project board (`rtk gh project item-list 7 --owner SecH0us3 --format json`), locate its item ID, and immediately update its status to "In Progress" (option ID `47fc9ee4` for field `Status` `PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0` in project `PVT_kwHOAFg2Ls4BdsI1`):
   `rtk gh project item-edit --id <item-id> --field-id PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0 --project-id PVT_kwHOAFg2Ls4BdsI1 --single-select-option-id 47fc9ee4`
2. Generate `implementation_plan.md`. CRITICAL: Read the ENTIRE task description from the GitHub Project board (Project #7, owner `SecH0us3`, using `rtk gh project item-list 7 --owner SecH0us3 --format json`) and explicitly include Documentation updates in the plan. Wait for user approval.
3. Write code, sandboxed unit tests, and Playwright E2E integration tests (in `tests/e2e/`). Run `scripts/test-backend.sh` and `bash tests/e2e/run-e2e.sh` to validate functionality and fix any reported SAST/linter warnings or E2E failures.
4. TEST AUDIT: Invoke the `test_auditor` subagent to review the PR/changes. DO NOT proceed until `test_auditor` confirms that all new logic is adequately covered by unit/integration tests.
5. UI QA EVALUATION: If the task involved significant frontend changes, evaluate if visual verification is necessary. If yes, invoke `qa_tester` to use built-in browser tools. Do not run UI tests blindly for minor UI tweaks.
6. INTEGRATION CHECK: Verify that new backend features are actually invoked by the main execution pipeline (`main.go` and `api/handlers.go`). Ensure frontend UI completely aligns with backend security constraints.
7. Update `README.md` or files in `docs/` to reflect any new configurations or features.
8. Generate a `walkthrough.md` artifact summarizing changes. **STOP** and wait for final human review.
9. Only update the task status to "Done" (option ID `98236657`):
   `rtk gh project item-edit --id <item-id> --field-id PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0 --project-id PVT_kwHOAFg2Ls4BdsI1 --single-select-option-id 98236657`
   upon explicit human consent.
10. SELF-CRITICAL REVIEW: Before final review, invoke the `self-critical-review` skill to systematically check for dead code, unused CSS styles, UTC timezone compliance, resource/memory leaks, and rule integrations.

## 📋 Code Quality & PR Constraints (AGENTS.md rules)
* **PR Merges**: NEVER merge a PR without explicit user approval. Do NOT run `gh pr merge` or use the `--auto` flag. Report the PR URL and wait.
* **Go URL Parameters**: Avoid manual query parameter formatting via string concatenation or `fmt.Sprintf`. Always parse with `net/url` and use the `Query()` API.
* **Frontend Styles**: No inline layout styles (e.g. `padding`, `margin`, `width`, `height`, `display`) in React component files. Define them in a CSS stylesheet instead.
* **E2E Test Usernames**: Username registration length is limited to **3 to 20 characters** (`^[a-zA-Z0-9_\-]{3,20}$`). Always generate random test usernames under 20 characters (e.g. using `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`).
* **1Password Popups**: Ignore sensitive inputs in modals/settings using `data-1p-ignore`.

