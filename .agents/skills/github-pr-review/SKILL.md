---
name: github-pr-review
description: Automates checking, reviewing, and addressing GitHub PR comments and code reviews. Trigger when asked to review PR comments.
---

# GitHub PR Review Workflow

When the user asks you to check PR comments, perform the following steps autonomously:

## 1. Fetch Comments
Use the GitHub CLI (`gh`) to fetch the latest comments and feedback from reviewers.
Since this project uses the `rtk` wrapper for token efficiency, use the following command:
`rtk gh pr view <PR_NUMBER> --comments`

If you need to view detailed reviews or comments in JSON format, you can use:
`rtk gh pr view <PR_NUMBER> --json reviews,comments`

## 2. Analyze Feedback
Carefully analyze the feedback. Identify actionable items:
- Bugs or logic errors
- Requested architectural changes
- Code style and naming improvements
- Missing tests or documentation

## 3. Plan and Execute
- **Draft a plan**: If the feedback requires significant structural changes, present a brief plan to the user and ask for confirmation. For straightforward fixes, proceed directly.
- **Implement**: Make the necessary changes in the corresponding files.
- **Verify**: Always run the relevant tests (e.g., by running `rtk go test ./...` inside the `packages/container` directory or running the script `./scripts/test-backend.sh`) to ensure the changes don't break existing functionality and actually fix the issue.

## 4. Commit and Push
Commit the changes using a descriptive commit message that references the PR or the fix.
```bash
rtk git commit -am "fix: address PR comments"
rtk git push
```

## 5. Reply and Resolve
After successfully pushing the fixes, notify the reviewer and resolve the thread (conceptually) by posting a reply to the PR.
Use the GitHub CLI to leave a top-level comment so the reviewer knows the feedback is addressed:
```bash
rtk gh pr comment <PR_NUMBER> -b "All review comments have been addressed in the latest commit. Please review."
```
*(If the reviewer requested specific line-by-line replies, use the `create_pull_request_review` MCP tool or direct `gh api` calls, but a general comment usually suffices).*

## 6. Report
Summarize to the user what was fixed and confirm that the PR reply has been posted. Inform them whether the PR is now ready for merge or needs further manual attention.
