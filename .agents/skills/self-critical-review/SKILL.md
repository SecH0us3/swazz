---
name: self-critical-review
description: Trigger this skill automatically before completing any roadmap task, or when making significant code changes. Perform a comprehensive, self-critical, and rigorous code review of changes to identify dead/redundant code, unused styling, logic bugs, security issues, performance hotspots, and design mismatch.
---

# Self-Critical Review Skill

This skill guides the agent in conducting a thorough, unbiased, and critical review of its own edits or pull request changes before presenting them to the user.

## Core Review Principles

1. **Unbiased Skepticism**: Assume your changes have introduced subtle bugs, dead code, or redundant styling. Trust but verify by checking every line.
2. **Systematic Cleanliness**: Never leave dead code, backups (`.bak`), unused imports, or orphan CSS classes behind when removing features.
3. **Strict Compliance**: Cross-check all changes against user-defined rules and project constraints (e.g., minimum character length, data attributes, net/url APIs).

## Self-Review Checklist

### 1. Code Deletion & Redundancy
* **Orphan CSS Rules**: When removing/modifying React components, always locate and delete the corresponding styling rules (e.g., tabs, success messages) in `.css` files.
* **Unused Helpers & Hooks**: Verify that hooks, interfaces, state variables, or API routes created during earlier iterations are not left as dead code.
* **Imports & Types**: Clean up unused imports, types, and dependencies using compiler checks (`npm run build` or `tsc`).

### 2. Security & Threat Model Integrity
* **No Security Regression**: Ensure that the new implementation does NOT lower the existing security bounds of the application. Do not bypass or disable verification checks (Turnstile, CSRF, TOTP, rate-limiting) in new endpoints or UI views.
* **Credential Safety**: Do not relax password constraints (always require at least 12 characters) or expose sensitive tokens, raw secrets, or keys in client payloads or server logs.
* **UTC/Timezone Resilience**: Never use local-timezone comparison. Always enforce timezone-agnostic epoch timestamps like `expiresAt.getTime() < Date.now()` for security validations.
* **Immediate State/Token Deletion**: When verifying single-use tokens (like challenges or session secrets), delete them from the database *immediately upon retrieval* rather than at the end of the handler to prevent concurrent replay attacks.
* **A checklist is not a threat model**: don't accept "added input validation" as proof of safety on its own — a pile of point-defenses without a coherent threat model tends to hide new, narrower bugs (half-finished defenses can be worse than none). Ask what specific attacker goal this change defends against, and whether the defense is actually finished, not just started.
* **Trap — list where a rule would do**: any hand-maintained allow/deny list (IP ranges, file extensions, MIME types, domains, headers) is suspect. Check whether a single predicate/shared function would cover the intent more completely, and whether this list already duplicates one that exists elsewhere in the codebase (duplicated SSRF/CIDR lists are the concrete example we already hit — see `internal/safenet.IsReservedOrPrivate`, the single source of truth `internal/security.IsPrivateIP` delegates to).
* **Trap — mismatched parsers**: if a value is validated once and compared or reused later (hostname pinning, path checks, filename checks), confirm both sides go through the *same* parser/normalizer. A validation step and a use step that parse differently is a classic TOCTOU/bypass (DNS rebinding, IDN/punycode, path traversal) and a check that fails silently defaults to allow, which is the wrong default.
* **Trap — unchecked outputs**: any attacker-influenced value the code returns, stores, or logs is live input to whatever reads it next (a downstream renderer, another service, a report viewer). Don't let a threat model stop at inbound validation — check `internal/output/` (SARIF/JSON/HTML) and any `og:*`/metadata-style pass-through fields for this.
* **Fail closed**: on parse error, ambiguity, or unexpected state, the code should deny/reject, not proceed. Flag any new code path where an error or edge case falls through to an allowed/default action.

### 3. Resource & Memory Leaks
* **Web Workers**: Revoke worker Object URLs (`URL.revokeObjectURL(workerUrl)`) immediately inside both `onmessage` and `onerror` handlers to prevent leaking memory in the browser.
* **Cleanup Functions**: Ensure all `useEffect` hooks return cleanups that reset intervals, event listeners, subscription states, or Turnstile widgets correctly.
* **Durable Objects & DB Locks**: Check for concurrent DB operations that could result in `SQLITE_BUSY` locks.

### 4. Project Guidelines Integration
* **1Password Ignored Inputs**: Double-check that sensitive inputs inside modals or settings forms use `data-1p-ignore` to suppress third-party autofill popups.
* **URL Parameter Formatting**: Ensure no manual query parameter formatting is done via string concatenation or `fmt.Sprintf` in Go; enforce the `Query()` API.
* **Go/React Naming**: Ensure constructors follow the package patterns (`New` vs `NewTypeName`) and React components don't contain inline layout styles (e.g., padding/margins).

## Execution Guide

To invoke this review on a branch:
1. Run `git diff origin/master --name-only` (or against the target base branch) to identify all modified files.
2. For each modified file:
   - Check imports and exports.
   - Match styles to JSX tags.
   - Audit database queries for immediate deletion.
3. Build the project and run both Vitest and E2E suites to confirm 100% correctness.
