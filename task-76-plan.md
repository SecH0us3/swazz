# Implementation Plan: Task 76 - AI-Based Findings Analysis with Local Repository Context

This plan details the step-by-step implementation for automatically analyzing, explaining, and fixing fuzzing findings using AI models (e.g., Claude or Gemini) with context from the client's local repository.

---

## 🛠️ Step 1: Database Schema Migration (Cloudflare Edge D1)
Extend the findings table schema to store AI-generated explanation, remediation metadata, code diffs, and pull request references.

1. **Create Migration:**
   - Add a new migration file under [packages/edge/migrations/](packages/edge/migrations/).
   - Add the following fields to the `findings` table:
     - `ai_status` (TEXT: `'none'`, `'analyzing'`, `'completed'`, `'failed'`)
     - `ai_relevance` (TEXT: `'confirmed'`, `'false_positive'`)
     - `ai_explanation` (TEXT)
     - `ai_remediation` (TEXT)
     - `ai_proposed_patch` (TEXT)
     - `pr_link` (TEXT)
2. **Update Edge Types & Queries:**
   - Update TypeScript interface definitions for findings in `packages/edge/src/types.ts`.
   - Update D1 query statements in findings handlers to retrieve/update these fields.

---

## 🔍 Step 2: Local Code Indexer & Symbol Resolver (Go CLI / Runner)
Implement a fast pre-indexing system in Go to parse the target repository and map URL routes/endpoints to specific source files.

1. **Create Pre-Indexer (`packages/container/internal/analyzer/indexer.go`):**
   - Implement directory scanning to locate code files (`.go`, `.ts`, `.js`, `.py`, `.java`, etc.).
   - Implement regex/AST-based route heuristic matcher (e.g., detecting `@GetMapping("/path")`, `r.GET("/path", handler)`, `router.route("/path")`).
   - Construct a lookup map of `[HTTP Method + Route Pattern] -> FilePath`.
2. **Create Context Resolver:**
   - Write helper to locate the matched handler function in the file.
   - Extract code context (e.g., ±50 lines around the route/handler declaration) and relevant local structures/types if imported.

---

## 🤖 Step 3: Multi-Stage LLM Client & Prompting (Go CLI / Runner)
Build the AI engine interface inside the runner to invoke cheap and expensive LLM models.

1. **Create LLM Client (`packages/container/internal/ai/client.go`):**
   - Support standard API calls (using official SDKs or raw HTTP requests) for Anthropic (Claude) and Gemini.
   - Use environment variables (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) for API authentication.
2. **Prompts configuration:**
   - Define base system prompts for vulnerability analysis (Relevance check) and fix generation (Remediation).
   - Read local instructions / prompt modifications configured per project.
3. **Analyze Pipeline:**
   - **First Stage (Cheap Model):** Send finding details + code snippet. Ask if the finding is a true positive (`confirmed` or `false_positive`).
   - **Second Stage (Expensive Model):** If confirmed, request the model to generate:
     - Clear explanation of the bug.
     - Actionable remediation steps.
     - A precise unified diff format patch.
   - **Custom CLI execution:** Also support running a local console command/wrapper (e.g. `claude -p`) if configured by the user.

---

## 🐙 Step 4: Automated Git & Pull Request Loop (Go CLI / Runner)
Provide automated code patching and repository synchronization.

1. **Local Patch Application:**
   - Implement Go utility to apply the generated unified diff patch to the local workspace folder.
2. **Validation Hook:**
   - If configured, execute testing commands (e.g., `go test ./...` or `npm test`) on the patched code.
   - Rollback and report test failure if compiling/tests fail.
3. **PR Creation:**
   - Use Git commands (or GitHub/GitLab REST API) to push changes to a branch named `swazz/fix-<finding-id>`.
   - Create a Pull Request and return the URL link.

---

## 🎨 Step 5: Web UI Visual Enhancements (React 19)
Build the dashboard panels to interact with AI-based reviews.

1. **Project Config update (`packages/web/src/components/ProjectSettings.tsx`):**
   - Add fields to configure:
     - LLM provider (Anthropic / Gemini / Custom CLI).
     - Default project prompt instructions.
     - Repository mapping settings.
2. **AI Remediation Panel (`packages/web/src/components/AiRemediation.tsx`):**
   - Display a clean UI inside the Finding Inspector when the "AI Insights" tab is active.
   - Render:
     - Relevance badge ("True Positive" / "False Positive").
     - Explanation & Remediation in Markdown format.
     - Side-by-side Diff Viewer of proposed changes.
     - "Create Pull Request" and "Apply Fix Locally" action buttons.
3. **Service Logic:**
   - Update `packages/web/src/services/findingsService.ts` to trigger `/api/findings/:id/analyze` endpoint.

---

## 📝 Step 6: Testing, Documentation & QA Audit
1. **Unit Testing:**
   - Add unit tests for the Go Indexer (`indexer_test.go`) validating router detection against dummy projects.
   - Add unit tests for prompt parsing and mock LLM calls.
2. **Verification & SAST:**
   - Run `scripts/test-backend.sh` to ensure Go compilation and safety checks pass.
3. **Documentation:**
   - Update [README.md](README.md) and [docs/](docs/) with instructions on setting up AI analysis, configuring API keys, and CLI/dashboard workflows.
