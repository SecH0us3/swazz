---
name: swazz-workflows
description: Core workflows and command instructions for the swazz project.
---
# Swazz Workflows & Tooling

This skill defines how to work with the `swazz` project.

## 🛠 Deterministic Helper Scripts
- Run `scripts/start-all.sh` to spin up the local dev environment (Vite + Go).
- Run `scripts/test-backend.sh` to execute the Go backend unit tests in the container package.

## 🔄 Development Architecture
- **Backend**: `packages/container/`. Contains fuzzing logic.
- **Frontend**: `packages/web/`. Contains React 19 UI. Use `modern-web-guidance`.

## 🤖 Autonomous Execution Flow (Human-in-the-Loop)
When handling a Task N, delegate to specialized subagents:
- **`backend_engineer`**: For Go code. Must run `bench.sh` on perf tasks.
- **`frontend_engineer`**: For React UI tasks.
- **`qa_tester`**: For writing E2E tests and validating Fuzzer benchmarks.

**Universal Workflow:**
1. Create a git branch `feature/task-N`.
2. Generate `implementation_plan.md`. CRITICAL: Read the ENTIRE task description in ROADMAP.md (including parentheses) and explicitly include Documentation updates in the plan. Wait for user approval.
3. Write code, sandboxed unit tests (`test-backend.sh`), and Fuzzer E2E tests.
4. INTEGRATION CHECK: Verify that new backend features are actually invoked by the main execution pipeline (`main.go` and `api/handlers.go`). Ensure frontend UI completely aligns with backend security constraints.
5. Update `README.md` or files in `docs/` to reflect any new configurations or features.
5. Mark task as `[/]` in ROADMAP.md, generate `walkthrough.md`, wait for review.
6. Only check off `[x]` upon explicit human consent.
