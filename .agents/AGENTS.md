# Swazz Project Rules

## PR Workflow
- **NEVER merge a PR without explicit user approval.** Always create the PR, then stop and wait for the user to review and confirm before merging.
- Do NOT run gh pr merge or pass the --auto flag automatically.
- After creating a PR, report the URL and wait for the user to say "merge" or similar confirmation.

## Security & Environment Config Guardrails
- **No dev-mode auth/security overrides in commits**: Never commit dev-mode overrides to `wrangler.toml` or security settings (e.g. `AUTH_ENABLED="false"`, `LIMIT_ANONYMOUS="false"`). Always audit `git diff` on infrastructure and environment files before committing to prevent accidentally pushing disabled authentication to production.

## Go Code Quality & Schema Defaults
- **Avoid manual URL query parameter formatting**: Never format query params using `fmt.Sprintf` or string concatenation. Always parse URLs with `net/url` and modify parameters via the `Query()` API.
- **Go / Frontend Schema Default Parity**: When adding new boolean settings in Go (`swagger.Settings`), if the default in the frontend UI is `true`, use optional pointer fields (`*bool`) and helper getter methods in Go (e.g. `SemanticMutationEnabled()`) so that missing JSON keys in existing project configs default to `true` instead of Go's zero-value `false`.
- **Complete LLM Pre-Scan Context**: When extracting OpenAPI schema context for LLM pre-scans or planners, always include all parameter types (`PathParams`, `QueryParams`, `HeaderParams`, and `Schema.Properties` body fields) rather than partially sampling query parameters alone.

## Frontend Layout & CSS
- **No inline layout styles**: Never write inline layout styles (such as `padding`, `margin`, `width`, `height`, `display`, etc.) in React component files. Instead, define them as proper CSS classes in the associated stylesheet (e.g. `index.css`).

## E2E Testing & Usernames
- **Username length validation**: In this project, the registration username limit is **3 to 20 characters** (matching `^[a-zA-Z0-9_\-]{3,20}$`). When generating unique usernames for E2E tests, always keep them under 20 characters (e.g. using `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`) to prevent validation failures.

## Code Search & Exploration
- **Prefer custom RAG tools**: For searching code or retrieving file structures/outlines, always prefer the custom MCP tools `swazz_search_code` and `swazz_get_file_context` over generic grep, find, or complete file views where possible.

## Task Discovery
- **Finding available tasks**: When the user asks what tasks are available, what to work on next, or requests a list of tasks — always fetch the GitHub Project board using the **`swazz_list_github_tasks` MCP tool** from the `swazz-rag` server. By default, it returns tasks in "Todo" status. Do not use raw `gh project` CLI commands.

## Roadmap Management
- **Roadmap updates on task completion**: When a task from the GitHub Project board is completed/implemented, always update its status to "Done" by invoking the **`swazz_update_task_status` MCP tool** from the `swazz-rag` server, passing the task's ID as `item_id`. Do not use raw `gh project` CLI commands.

## Branch Verification & Metadata Scripts
- **Running complete test suite**: Before finishing or reviewing any branch, verify compilation, unit/integration tests, and frontend build. Do NOT run the full E2E test suite automatically. Instead, ask the user before running full E2E tests, or run only targeted tests covering the changed functionality (e.g., `bash tests/e2e/run-e2e.sh tests/e2e/<targeted>.spec.ts`).
- **Running frontend unit tests**: When running `vitest` unit tests for the frontend (`packages/web`), always run the test command with the working directory set to `packages/web/` (e.g. command `rtk npx vitest run src/components/UserSettings.test.tsx` with Cwd `packages/web`). Running from the root directory will cause JSDOM environment errors (like `window is not defined`).
- **Checking branch metadata**: To get current branch status, default branch, merge base, and changed files in JSON format, run `bash scripts/git-meta.sh`.
- **Vibe Code Review**: Before finishing feature branch development, run `./scripts/vibe-review.sh` (or `rtk ./scripts/vibe-review.sh < /dev/null`) to trigger an automated code review using Vibe. Verify the generated review at `docs/reviews/vibe-review.md` and address any code quality or styling violations.
## Git and Tracking
- **Never track docs/superpowers/**: The `docs/superpowers/` folder contains plan and design files that are gitignored. Do NOT run `git add -f` or track any files under `docs/superpowers/` in Git. Keep them local and untracked.

## SOFA Usage
When beginning meaningful work in this project, create or confirm a SOFA API session using your configured SOFA credentials.

If no SOFA credential is configured, tell the human that this project uses SOFA for agent knowledge sharing and offer to run agent-directed onboarding for a personal SOFA agent. If the human declines, or if existing project guidance defines a credential setup, follow that direction and continue.

After connecting to SOFA, check SOFA attention if available.

Before spending meaningful time on uncertain technical work, search SOFA for existing questions, TILs, Blueprints, Playbooks, or replies that could apply. Prefer higher-trust results when several posts fit, but inspect the content before relying on it.

When SOFA content helps, vote at read time if you can judge usefulness. After you actually apply guidance from a post, verify the post with the observed outcome.

Before ending meaningful coding, debugging, configuration, or research work, decide whether the session produced reusable knowledge. If it did, contribute with the smallest matching SOFA primitive: vote, verification, reply, TIL, question, Blueprint, or Playbook.

Do not publish public SOFA content without following the agent role, publication policy, moderation, and human-approval requirements.

