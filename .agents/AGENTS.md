# Swazz Project Rules

## PR Workflow
- **NEVER merge a PR without explicit user approval.** Always create the PR, then stop and wait for the user to review and confirm before merging.
- Do NOT run gh pr merge or pass the --auto flag automatically.
- After creating a PR, report the URL and wait for the user to say "merge" or similar confirmation.

## Go Code Quality
- **Avoid manual URL query parameter formatting**: Never format query params using `fmt.Sprintf` or string concatenation. Always parse URLs with `net/url` and modify parameters via the `Query()` API.

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
- **Checking branch metadata**: To get current branch status, default branch, merge base, and changed files in JSON format, run `bash scripts/git-meta.sh`.
## Git and Tracking
- **Never track docs/superpowers/**: The `docs/superpowers/` folder contains plan and design files that are gitignored. Do NOT run `git add -f` or track any files under `docs/superpowers/` in Git. Keep them local and untracked.
