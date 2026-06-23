---
name: swazz-workflows
description: Core workflows and command instructions for the swazz project.
---
# Swazz Workflows & Tooling

This skill defines how to work with the `swazz` project.

## 🛠 Deterministic Helper Scripts
- Run `npm run dev` to spin up the local dev environment (Vite frontend + Cloudflare edge coordinator).
- Run `scripts/test-backend.sh` to execute the Go backend unit tests, compiler checks (`go vet`), and SAST security scans (`gosec`).

## 🔄 Development Architecture
- **Backend**: `packages/container/`. Contains fuzzing logic.
- **Frontend**: `packages/web/`. Contains React 19 UI. Use `modern-web-guidance`.

## 🤖 Autonomous Execution Flow (Human-in-the-Loop)
When handling a Task N, delegate to specialized subagents:
- **`backend_engineer`**: For Go code. Must run Go benchmarks (`go test -bench=. ./...` in `packages/container`) on performance tasks.
- **`frontend_engineer`**: For React UI tasks.
- **`qa_tester`**: For writing E2E tests and validating Fuzzer benchmarks.

**Universal Workflow:**
1. Create a git branch `feature/task-N`.
2. Generate `implementation_plan.md`. CRITICAL: Read the ENTIRE task description in ROADMAP.md (including parentheses) and explicitly include Documentation updates in the plan. Wait for user approval.
3. Write code, sandboxed unit tests, and Playwright E2E integration tests (in `tests/e2e/`). Run `scripts/test-backend.sh` and `bash tests/e2e/run-e2e.sh` to validate functionality and fix any reported SAST/linter warnings or E2E failures.
4. TEST AUDIT: Invoke the `test_auditor` subagent to review the PR/changes. DO NOT proceed until `test_auditor` confirms that all new logic is adequately covered by unit/integration tests.
5. UI QA EVALUATION: If the task involved significant frontend changes, evaluate if visual verification is necessary. If yes, invoke `qa_tester` to use built-in browser tools. Do not run UI tests blindly for minor UI tweaks.
6. INTEGRATION CHECK: Verify that new backend features are actually invoked by the main execution pipeline (`main.go` and `api/handlers.go`). Ensure frontend UI completely aligns with backend security constraints.
7. Update `README.md` or files in `docs/` to reflect any new configurations or features.
8. Mark task as `[/]` in ROADMAP.md, generate `walkthrough.md`, wait for review.
9. Only check off `[x]` upon explicit human consent.
