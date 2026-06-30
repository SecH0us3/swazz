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

