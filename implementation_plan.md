# Implementation Plan - Task 58: Content Security Policy (CSP) Security Analysis

## 🎯 Goal
Implement Content Security Policy (CSP) security analysis to detect missing, insecure, or overly permissive policies in target HTTP responses.

## 🛠 Proposed Changes

### 1. Go Backend: CSP Response Analyzer (`packages/container/internal/analyzer/csp.go`)
- Create a new `CSPAnalyzer` struct implementing `ResponseAnalyzer` interface:
  - Parse headers: `Content-Security-Policy` and `Content-Security-Policy-Report-Only`.
  - **`swazz/csp-missing`** (Level: `warning`): Flagged if the response is an HTML page (`Content-Type` contains `text/html`) and both CSP headers are absent.
  - **`swazz/csp-unsafe-directive`** (Level: `error`): Flagged if directives within either CSP header contains:
    - Wildcard sources (`*`)
    - `'unsafe-inline'`
    - `'unsafe-eval'`
- Register the new `CSPAnalyzer` in the central analyzer registry (`packages/container/internal/analyzer/registry.go`).

### 2. OWASP Top 10 (2025) Classification (`packages/container/internal/classifier/owasp.go`)
- Map `swazz/csp-missing` and `swazz/csp-unsafe-directive` to `"A02:2025 Security Misconfiguration"`.
- Update classification tests in `packages/container/internal/classifier/owasp_test.go`.

### 3. Documentation
- Document the new rule IDs in:
  - [docs/usage.md](file:///Users/alex/src/swazz/docs/usage.md) (Vulnerability Types section)
  - [docs/ci_cd.md](file:///Users/alex/src/swazz/docs/ci_cd.md) (Rule IDs table)

## 🧪 Verification Plan
- **Unit Tests**:
  - Add `packages/container/internal/analyzer/csp_test.go` covering:
    - Missing CSP on HTML responses.
    - Valid CSP (no findings).
    - Unsafe directives (`*`, `'unsafe-inline'`, `'unsafe-eval'`) in both standard and Report-Only headers.
    - Non-HTML responses (no missing CSP alert).
  - Run all Go backend tests: `scripts/test-backend.sh`
- **E2E / Integration Checks**:
  - Verify overall compilation and build.
