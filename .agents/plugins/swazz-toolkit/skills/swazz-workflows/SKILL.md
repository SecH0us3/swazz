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
  - To stop: `bash scripts/stop-local-dev.sh`
- Run `scripts/test-backend.sh` to execute the Go backend unit tests, compiler checks (`go vet`), and SAST security scans (`gosec`).

## 🔍 Code Navigation & RAG Search
- **Prefer RAG tools when available**: When the `swazz-rag` MCP server is connected, prefer `swazz_search_code` and `swazz_get_file_context` to conserve tokens; if the MCP server is unavailable in the current session, fall back to `rg`/`grep` and targeted line-range reads.

## 🔄 Development Architecture
- **Backend**: `packages/container/` (Go engine: analyzers, payload generators, runner, agent, output formatters).
- **Frontend**: `packages/web/` (React 19 + Zustand UI; use `modern-web-guidance`).
- **Edge**: `packages/edge/` (Cloudflare Workers + Hono + D1 + R2 coordinator).
- **Extension**: `packages/extension/` (Chrome MV3 extension).

## 🤖 Autonomous End-to-End Delivery Flow (Risk-Gated)
A single Delivery agent (**Antigravity Orchestrator**) owns a task end-to-end from planning through CI-green PR; independent Orca **`Review Bot`** (Claude) owns cross-model code & security review. When helpful, delegate focused slices to specialized subagents:
- **`backend_engineer`**: For Go code. Must run Go benchmarks (`go test -bench=. -run=^$ ./...` in `packages/container`) on performance tasks.
- **`frontend_engineer`**: For React UI tasks.
- **`qa_tester`**: For writing E2E tests and validating Fuzzer benchmarks.
- **`test_auditor`**: For auditing unit/integration test coverage on new logic.

**Definition of Done (8-Step Delivery Checklist):**
1. **Plan & Threat-Model (Risk-Gated Auto-Proceed)**: Research the codebase, run a threat-model pass for network I/O, auth, storage, or output rendering, and proceed straight to implementation by default. Pause for user confirmation ONLY if the user asked for `/plan` or `/grill-me`, there is an irreversible architectural/API/D1-schema fork or risky trade-off, or requirements are ambiguous.
2. **Implement & Tests**: Write code and sandboxed unit tests (`-race` on concurrent packages, `-count=100+` on randomized/generator tests). Run `bash scripts/add-copyright-headers.sh`, `scripts/test-backend.sh`, frontend `vitest` (with Cwd `packages/web/`), `tsc --noEmit`, `npm run build`, `cd packages/extension && npm test` (when touching the extension), and **targeted** E2E tests (`bash tests/e2e/run-e2e.sh tests/e2e/<targeted>.spec.ts`) — never run the full E2E suite automatically.
3. **Test Audit & Integration Check**: Invoke `test_auditor` to verify coverage, and verify new backend features are wired into `main.go`, `internal/agent/`, and `internal/runner/` and aligned with frontend constraints.
4. **Docs Gate (Mandatory Acceptance Criterion)**: Update `docs/` and `README.md` in the same PR whenever user-facing behavior, settings, CLI flags, UI, analyzers, or architecture change (or explain why in `## Docs`, e.g., `N/A — internal refactor`), and refresh `AGENTS.md` if packages/scripts/workflows changed. Enforced by `.github/workflows/pr-docs-gate.yml` and `Review Bot`.
5. **Self-Critical Review**: Invoke `self-critical-review` to check for dead code, unused CSS, UTC compliance, leaks, and rule alignment.
6. **Open PR**: Push branch and open PR per `.github/PULL_REQUEST_TEMPLATE.md` and `AGENTS.md` (with a Mermaid diagram for non-trivial changes, `Docs` section, verification output, and no AI attribution).
7. **Cross-Model Review (`Review Bot`)**: Request review from Orca `Review Bot` (Claude) — do NOT run `scripts/vibe-review.sh`. Fix `[BLOCKER]` and safe non-regressing `[WORTH FIXING]` items, then send round 2 with incremental commit SHAs (max 2 rounds; escalate if still blocked).
8. **CI Green & Merge Policy**: Wait for `gh pr checks --watch`, auto-fix CI failures (max 2 rounds), and report the PR URL + summary + `Review Bot` verdict + CI status. Stop before merge unless the user explicitly authorized auto-merge for this task. After merge, update any linked GitHub Project item to "Done" (`98236657` / `swazz_update_task_status`).

## 📋 Code Quality & PR Constraints (AGENTS.md rules)
* **PR Merges & Description Standard**: Follow `.github/PULL_REQUEST_TEMPLATE.md` and `AGENTS.md` (Mermaid diagram for non-trivial changes + Docs Gate). NEVER merge a PR without explicit user approval (or explicit task-level auto-merge authorization after green CI + `Review Bot` approval); never pass `--auto`.
* **Go URL Parameters**: Avoid manual query parameter formatting via string concatenation or `fmt.Sprintf`. Always parse with `net/url` and use the `Query()` API.
* **Frontend Styles**: No inline layout styles (e.g. `padding`, `margin`, `width`, `height`, `display`) in React component files. Define them in a CSS stylesheet instead.
* **E2E Test Usernames**: Username registration length is limited to **3 to 20 characters** (`^[a-zA-Z0-9_\-]{3,20}$`). Always generate random test usernames under 20 characters (e.g. using `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`).
* **1Password Popups**: Ignore sensitive inputs in modals/settings using `data-1p-ignore`.

