# AI Remediation Guide

The AI Remediation feature in Swazz allows you to automatically analyze, triage, and propose fixes for vulnerabilities found during fuzzing using LLMs and AI Agents.

## Setup & Prerequisites

Because Swazz operates on a Zero-Liability security model, Git credentials and API keys are **never** stored in the database or UI. Instead, the local Go Runner relies on your host environment.

1. **GitHub / GitLab CLI**:
   Ensure `gh` or `glab` is installed and authenticated in the environment where the Runner executes. The Runner uses these tools to automatically open Pull/Merge Requests.
   - For GitHub: `gh auth login`
   - For GitLab: `glab auth login`

2. **Git Authentication**:
   Ensure your local Git is authenticated via SSH or configured credential helpers, as the runner will clone and push branches using local Git worktrees.

3. **AI Agent CLI**:
   Ensure your custom AI Agent CLI (e.g. `claude` or `agy`) is installed and authenticated if you use the Custom CLI execution feature.

## Configuration in UI

In the **Project Settings -> AI Remediation Config** tab:

1. **URL to Repository Mappings**:
   Provide a JSON object mapping API path prefixes to Git repository URLs. 
   ```json
   {
     "/api/auth/*": "git@github.com:my-org/auth-service.git",
     "/api/billing/*": "git@github.com:my-org/billing-service.git"
   }
   ```
   The local code indexer will use this mapping to fetch the relevant context for a finding.

2. **AI System Prompts**:
   You can provide custom JSON or text for your prompts to instruct the AI how to behave during triage (Pass 1) and remediation (Pass 2).

3. **Custom CLI Command**:
   If you rely on external AI tools, provide the execution template. The runner replaces `{{prompt_file}}` with the path to the secure temporary prompt file.
   Example: `agy -p {{prompt_file}}`

4. **Rules to Auto-Fix**:
   Specify a JSON array of vulnerability IDs that you trust the AI to automatically patch.
   Default: `["swazz/bola-idor", "swazz/network-error", "swazz/null-pointer-exception", "swazz/timeout"]`

5. **Propose Fixes Automatically**:
   Check this box to enable the automated Git Worktree patching and PR creation workflow.

## Tech Stack & Rule Autocompletion

To refine remediation suggestions, Swazz allows you to tune AI prompts using target application contexts:

* **Target Tech Stacks**: Check the tech stacks used by your application (e.g. React, Node, Go, Python, Postgres, .NET, Flask, Django, Next.js, FastAPI, Spring Boot). Checking a stack automatically appends standard security rules and guidelines (such as avoiding inline layout styles in React, using EF Core parameterized queries in .NET, or safe route handlers in Next.js) to the triage and remediation templates.
* **Auto-Fix Rules Context**: Toggling rules in the "Select Auto-Fix Rules" modal automatically appends rule-specific security goals (like validating resource ownership for IDOR/BOLA or checking null-pointer references) into the prompts.
* **Dynamic Cleaning**: Unchecking any stack or rule automatically parses the prompt templates using markers (e.g. `=== Tech Stack: Go ===`) and cleanly removes the respective instruction block, preserving any manual modifications you have written.

## How it works safely
When a finding occurs:
1. The AI engine wraps the untrusted payload inside `<untrusted-finding-context>` to mitigate Prompt Injections.
2. The Runner executes `exec.Command` directly (without `bash` or `sh`) to prevent command injection.
3. If "Propose Fixes" is enabled, a temporary `git worktree` is created alongside your existing repository clone to apply the patch, commit, push, and create a PR without polluting your active workspace.
