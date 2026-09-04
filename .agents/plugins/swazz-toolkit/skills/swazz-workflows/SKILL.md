---
name: swazz-workflows
description: Core workflows and command instructions for the swazz project.
---
# Swazz Workflows & Tooling

This skill defines how to work with the `swazz` project.

## 🛠 Deterministic Helper Scripts
- **Full local dev stack**: Run `bash scripts/start-local-dev.sh` to spin up the entire environment in one command:
  - Writes test secrets to `packages/edge/.dev.vars`
  - Applies D1 database migrations and seeds a CI user
  - Starts **Vulnerable Demo API** on `:8788` (background)
  - Starts **Edge Coordinator** (Wrangler) on `:8787` (background)
  - Starts **React frontend** (Vite) on `:5173` (background)
  - Compiles and starts **Go Runner Agent** with `--dangerous-no-container`
  - Logs: `demo.log`, `edge.log`, `web.log`, `packages/container/agent.log`
  - To stop: `pkill -f wrangler; pkill -f vite; pkill -f swazz-engine`
- Run `scripts/test-backend.sh` to execute the Go backend unit tests, compiler checks (`go vet`), and SAST security scans (`gosec`).

## 🔍 Code Navigation & RAG Search
- **MANDATORY RAG tools usage**: You MUST use the MCP tools `swazz_search_code` (for semantic and keyword search) and `swazz_get_file_context` (for structured outlines of files) as your primary methods for code navigation and search. Do not use generic grep search or view full files using `view_file` unless the RAG tools are not applicable, have failed, or you explicitly need to read the entire file. This keeps token usage optimal.

## 🔄 Development Architecture
- **Backend**: `packages/container/`. Contains fuzzing logic.
- **Frontend**: `packages/web/`. Contains React 19 UI. Use `modern-web-guidance`.

## 🤖 Autonomous Execution Flow (Human-in-the-Loop)
Task discovery, planning, and final diff review are owned by **Claude Code**. Antigravity is the execution engine: it implements directly from an already-approved `implementation_plan.md` and must not regenerate its own plan. When handling a Task N, delegate to specialized subagents:
- **`backend_engineer`**: For Go code. Must run Go benchmarks (`go test -bench=. -run=^$ ./...` in `packages/container`) on performance tasks.
- **`frontend_engineer`**: For React UI tasks.
- **`qa_tester`**: For writing E2E tests and validating Fuzzer benchmarks.

**Handoff Contract:** Claude Code has already created the branch, set the GitHub Project item to "In Progress", and written the approved `implementation_plan.md` before Antigravity is invoked. If the plan is missing, ambiguous, or contradicts the current codebase, STOP and report back to Claude Code rather than improvising scope.

**Execution Workflow:**
1. Read `implementation_plan.md` in full and implement directly from it — do not re-plan or expand scope beyond what it specifies.
2. Write code, sandboxed unit tests, and Playwright E2E integration tests (in `tests/e2e/`). Run `bash scripts/add-copyright-headers.sh` to ensure BSL 1.1 headers on all new source files, and run `scripts/test-backend.sh` and `bash tests/e2e/run-e2e.sh` to validate functionality and fix any reported SAST/linter warnings or E2E failures.
3. TEST AUDIT: Invoke the `test_auditor` subagent to review the PR/changes. DO NOT proceed until `test_auditor` confirms that all new logic is adequately covered by unit/integration tests.
4. UI QA EVALUATION: If the task involved significant frontend changes, evaluate if visual verification is necessary. If yes, invoke `qa_tester` to use built-in browser tools. Do not run UI tests blindly for minor UI tweaks.
5. INTEGRATION CHECK: Verify that new backend features are actually invoked by the main execution pipeline (`main.go` and `api/handlers.go`). Ensure frontend UI completely aligns with backend security constraints.
6. Update `README.md` or files in `docs/` to reflect any new configurations or features.
7. SELF-CRITICAL REVIEW: Invoke the `self-critical-review` skill to systematically check for dead code, unused CSS styles, UTC timezone compliance, resource/memory leaks, and rule integrations.
8. Commit the changes and hand control back to Claude Code. Do NOT run the Vibe/Mistral code review script (`scripts/vibe-review.sh`) — Claude Code performs the diff review (correctness, security, adherence to the plan) instead.

**Final Review & Completion (Claude Code):** Review the resulting diff against `implementation_plan.md`, generate a `walkthrough.md` artifact summarizing changes and findings, and **STOP** for final human review. Only update the task status to "Done" (option ID `98236657`) upon explicit human consent:
   `rtk gh project item-edit --id <item-id> --field-id PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0 --project-id PVT_kwHOAFg2Ls4BdsI1 --single-select-option-id 98236657`

## 📋 Code Quality & PR Constraints (AGENTS.md rules)
* **PR Merges**: NEVER merge a PR without explicit user approval. Do NOT run `gh pr merge` or use the `--auto` flag. Report the PR URL and wait.
* **Go URL Parameters**: Avoid manual query parameter formatting via string concatenation or `fmt.Sprintf`. Always parse with `net/url` and use the `Query()` API.
* **Frontend Styles**: No inline layout styles (e.g. `padding`, `margin`, `width`, `height`, `display`) in React component files. Define them in a CSS stylesheet instead.
* **E2E Test Usernames**: Username registration length is limited to **3 to 20 characters** (`^[a-zA-Z0-9_\-]{3,20}$`). Always generate random test usernames under 20 characters (e.g. using `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`).
* **1Password Popups**: Ignore sensitive inputs in modals/settings using `data-1p-ignore`.

