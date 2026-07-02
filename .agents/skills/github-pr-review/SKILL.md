---
name: github-pr-review
description: Automates checking, reviewing, and addressing GitHub PR comments and code reviews. Trigger when asked to review PR comments.
---

# GitHub PR Review Workflow

When the user asks you to check PR comments, perform the following steps autonomously:

## 1. Fetch Comments
Use a single GraphQL query via the GitHub CLI (`gh api graphql`) to fetch all PR-level comments, reviews, and active review comment threads (including their GraphQL `id` and `isResolved` status) in a single network roundtrip:
```bash
rtk gh api graphql -F number=<PR_NUMBER> -f query='
  query($number: Int!) {
    repository(owner: "SecH0us3", name: "swazz") {
      pullRequest(number: $number) {
        comments(last: 100) { nodes { body } }
        reviews(last: 100) {
          nodes {
            body
            state
          }
        }
        reviewThreads(last: 100) {
          nodes {
            id
            isResolved
            comments(last: 100) {
              nodes {
                path
                line
                body
              }
            }
          }
        }
      }
    }
  }
'
```

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
After successfully pushing the fixes, resolve all discussion threads you have addressed on the PR using the GitHub GraphQL API:
```bash
# Repeat for each addressed thread's GraphQL ID
rtk gh api graphql -F id="<THREAD_ID>" -f query='
  mutation($id: ID!) {
    resolveReviewThread(input: {threadId: $id}) {
      thread { isResolved }
    }
  }
'
```

Additionally, leave a top-level comment so the reviewer knows the feedback has been resolved:
```bash
rtk gh pr comment <PR_NUMBER> -b "All review comments have been addressed in the latest commit and the threads have been resolved. Please review."
```

## 6. Report
Summarize to the user what was fixed and confirm that the PR reply has been posted. Inform them whether the PR is now ready for merge or needs further manual attention.
