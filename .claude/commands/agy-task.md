Run a GitHub Project task end-to-end with work split between Claude Code (plan + review) and Antigravity CLI (implementation + tests), looping fix rounds until the diff is clean.

Usage: `/agy-task <task number, e.g. 5>`

## Mechanism

Antigravity is driven headlessly through the `agy` CLI (`~/.local/bin/agy`), not the GUI — confirmed working via `agy --print "<prompt>" --output-format json`, which returns `{"conversation_id", "status", "response", ...}`.

- `--mode accept-edits` lets it apply file edits without an interactive prompt.
- `--dangerously-skip-permissions` is required for any unattended run — in `--print` mode there is no human to answer a tool-permission prompt, and without this flag the call hangs until `--print-timeout` and does nothing (verified: a bare `/swazz-toolkit:swazz-workflows` print call timed out at 30s with no repo changes, consistent with it stalling on the first gated tool call).
- Pair it with `--sandbox` every time to bound what an unattended, unreviewed tool call can actually do. Never drop `--sandbox` and never point this at anything outside the swazz repo.
- `--model gemini-3.8-flash-high` is the "Flash 3.8, max effort" model (confirmed present in `agy models`). Do NOT also pass `--effort` with this model — it errors (`--effort is not supported for model "Gemini 3.8 Flash (High)"`); the `-high` suffix already is the max-effort tier for Flash models.
- The first call's `conversation_id` must be reused via `--conversation <id>` on every follow-up call for the same task, so Antigravity keeps context instead of restarting cold each fix round.
- Run `agy` from the swazz project root so `.agents/plugins/swazz-toolkit` auto-loads.
- This exact end-to-end loop (delegate → review → fix round) has not yet been run live — the mechanism above is verified piece by piece (print mode, JSON output, `--agent`, model name, the permission-hang failure mode), but treat the first real invocation as a trial run and watch it closely.

## Steps

1. **Find, Branch & Start** *(Claude Code)*: Find the task on the GitHub Project board (`rtk gh project item-list 7 --owner SecH0us3 --format json`), locate its item ID, set status to "In Progress" (option ID `47fc9ee4`, field `PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0`, project `PVT_kwHOAFg2Ls4BdsI1`):
   `rtk gh project item-edit --id <item-id> --field-id PVTSSF_lAHOAFg2Ls4BdsI1zhYL6f0 --project-id PVT_kwHOAFg2Ls4BdsI1 --single-select-option-id 47fc9ee4`
   Create and check out branch `feature/task-N`.

2. **Plan** *(Claude Code)*: Research the codebase and write `docs/superpowers/plans/task-N-<slug>.md` (gitignored, local-only — matches the existing convention in that folder) at spec level: exact files to touch, function/component signatures, edge cases, and an explicit "do not touch" list. This plan is the only thing constraining a Flash-tier model's scope, so ambiguity here becomes scope drift there. **STOP** and get explicit user approval before continuing.

3. **Delegate & Execute** *(Antigravity via `agy`)*: Once approved, launch with the Bash tool's `run_in_background: true` (this can run many minutes):
   ```
   agy --print "$(cat <<'EOF'
   /swazz-toolkit:swazz-workflows

   Implement docs/superpowers/plans/task-N-<slug>.md exactly as written, on branch feature/task-N (already checked out). Do not re-plan or expand scope beyond the plan — if it is ambiguous or contradicts the codebase, stop and report back instead of improvising. Run scripts/test-backend.sh and targeted E2E tests yourself and fix failures before finishing. Commit when done.
   EOF
   )" --mode accept-edits --dangerously-skip-permissions --sandbox --model gemini-3.8-flash-high --output-format json --print-timeout 1800s
   ```
   Record the returned `conversation_id`. If `status` is `ERROR` (including a permission-hang timeout), do not blindly retry — inspect `git status`/`git diff` for partial changes first, then either resume the conversation with a narrower prompt or report back to the user.

4. **Review** *(Claude Code)*: Run `git diff` against `docs/superpowers/plans/task-N-<slug>.md` with the same rigor as a `/code-review` or `/security-review` pass: correctness, security, adherence to the plan, no unrequested scope. List concrete issues as `file:line — required fix`, or none.

5. **Fix loop** *(Antigravity via `agy`, capped at 3 rounds)*: If issues were found, send ONE consolidated prompt with the full numbered list back into the same conversation:
   ```
   agy --print "<numbered issue list, each with file:line and the exact required fix>" --conversation <conversation_id> --mode accept-edits --dangerously-skip-permissions --sandbox --model gemini-3.8-flash-high --output-format json --print-timeout 900s
   ```
   Re-run step 4 after each round. After 3 rounds with issues still open, STOP — hand the remaining list to the user instead of continuing to loop.

6. **Complete** *(Claude Code)*: Once the diff is clean, write `walkthrough.md` summarizing the changes and the review/fix history, and **STOP** for final human review. Only after explicit approval, set the task status to "Done" (option ID `98236657`, same field/project IDs as step 1) and merge/commit per the PR rules in `.agents/AGENTS.md` — never merge without explicit user approval.

## Safety notes
- `--dangerously-skip-permissions` + `--sandbox` is what makes unattended delegation possible at all — every `agy` call in this flow can run arbitrary shell commands inside the sandbox with no one watching in real time. Keep both flags on every call, never widen `--add-dir` beyond this repo.
- The 3-round fix cap exists so a confused Flash-tier session escalates to a human instead of quietly churning.
- Antigravity's subagents (`backend_engineer`, `sec_auditor`, etc. in `.agents/plugins/swazz-toolkit/agents/`) have `enable_write_tools: true` by design — that's what step 3 depends on, and it's exactly why step 2's plan has to be unambiguous.
