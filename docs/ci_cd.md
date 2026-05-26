---
layout: default
title: CI/CD Integration
---

# CI/CD Integration Guide 🔄

Swazz is designed to slot into modern CI/CD pipelines as a first-class security gate. By running automated fuzz tests on every pull request or merge, you can catch crashes, unexpected 5xx errors, and logic flaws before they reach production.

This guide covers:
- [GitHub Actions — Full SARIF Workflow](#github-actions-sarif-reporting)
- [GitLab CI — Security Dashboard](#gitlab-ci)
- [Configuration Tips for CI Environments](#configuration-tips-for-ci)
- [Understanding SARIF Findings](#understanding-sarif-findings)
- [Interpreting Results & Build Gates](#interpreting-results--build-gates)

---

## Prerequisites

Before wiring Swazz into a pipeline you need:

1. **A reachable target API** — either a staging environment, an ephemeral preview deployment, or a locally spun-up test server within the same CI job.
2. **A `swazz.config.json`** — committed to your repository (or generated at runtime). See [Usage & Configuration](./usage.html) for the full schema.
3. **The `swazz-engine` binary** — built from source (Go 1.21+) or pulled from a [GitHub Release](https://github.com/SecH0us3/swazz/releases).

---

## GitHub Actions — SARIF Reporting

The workflow below builds Swazz from source, runs the fuzzer, and uploads the results to **GitHub Advanced Security Code Scanning** as SARIF. Findings appear inline on pull requests alongside CodeQL and GoSec results.

```yaml
# .github/workflows/swazz.yml
name: Swazz API Fuzzer

on:
  push:
    branches: [master]
    paths:
      - 'swazz.config.json'   # re-run when fuzzer config changes
      - 'openapi/**'           # re-run when API specs change
  pull_request:
    branches: [master]

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  swazz-fuzz:
    name: API Fuzz & SARIF Upload
    runs-on: ubuntu-latest

    # These permissions are required for SARIF upload to GitHub Code Scanning.
    permissions:
      actions: read
      contents: read
      security-events: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - name: Set up Go
        uses: actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff # v5.6.0
        with:
          go-version: '1.26.3'
          cache-dependency-path: packages/container/go.sum

      - name: Build swazz-engine
        run: |
          cd packages/container
          CGO_ENABLED=0 go build -ldflags="-s -w" -o swazz-engine main.go

      # ── Optional: spin up your test server here ──────────────
      # - name: Start demo API
      #   run: |
      #     cd demo && go run main.go &
      #     sleep 2   # give the server time to bind
      # ─────────────────────────────────────────────────────────

      - name: Run Swazz fuzzer
        # continue-on-error so SARIF upload always runs even when
        # --fail-on-error causes an exit code 1.
        continue-on-error: true
        working-directory: packages/container
        run: |
          ./swazz-engine start \
            --config ../../swazz.config.json \
            --sarif  swazz.sarif \
            --fail-on-error

      - name: Upload SARIF to GitHub Code Scanning
        # Always upload — even if the fuzzer found errors.
        if: always()
        uses: github/codeql-action/upload-sarif@9e0d7b8d25671d64c341c19c0152d693099fb5ba # v4.35.5
        with:
          sarif_file: packages/container/swazz.sarif
          category: swazz-api-fuzzer
```

> **Supply-chain note:** Every `uses:` line above is pinned to a specific commit SHA — the same SHAs already used in the project's own `sast.yml` workflow. Never use mutable tags like `v4` or `latest`, as they can be silently replaced.

### How it works

1. **Build** — Swazz is compiled from source in the same Go version used by the project (`1.26.3`).
2. **Fuzz** — `swazz-engine start` reads `swazz.config.json`, fetches your OpenAPI spec, and hammers every endpoint with boundary, random, and malicious payloads.
3. **`--fail-on-error`** — causes the binary to exit with code `1` if any `error`-level findings are detected. Combined with `continue-on-error: true`, this lets the workflow record a failure *without* blocking the SARIF upload step.
4. **SARIF upload** — the `upload-sarif` action ships results to GitHub's Code Scanning backend, where they are surfaced in the **Security → Code scanning alerts** tab and annotated on PR diffs.

---

## GitLab CI

Depending on your GitLab version and tier, you can integrate Swazz in one of three ways:

1. **Native SARIF Ingestion (GitLab 18.11+ / Ultimate):** Upload the SARIF report directly.
2. **GitLab SAST Report Format (GitLab Ultimate):** Convert SARIF to `gl-sast-report.json` using a converter tool.
3. **Basic Artifacts (GitLab Free / All Tiers):** Download and inspect `swazz.sarif` manually.

### Option A: Native SARIF Ingestion (GitLab 18.11+)

If you are using a GitLab version that supports native SARIF reports, you can specify `reports: sarif` directly in your configuration:

```yaml
# .gitlab-ci.yml
stages:
  - security

swazz-fuzz:
  stage: security
  # Pinned to specific alpine-based Go image digest for supply-chain security
  image: golang:1.26.3-alpine@sha256:70dd6c2a4efd226a0b7cfb5ad289bf65d83626e542dbde55d491f24d45542a27
  script:
    - cd packages/container
    - CGO_ENABLED=0 go build -ldflags="-s -w" -o swazz-engine main.go
    - |
      ./swazz-engine start \
        --config ../../swazz.config.json \
        --sarif  swazz.sarif \
        --fail-on-error
  artifacts:
    when: always
    reports:
      sarif: packages/container/swazz.sarif
    paths:
      - packages/container/swazz.sarif
    expire_in: 30 days
  allow_failure: true   # advisory gate — set to false to block merge requests
```

### Option B: GitLab SAST Ingestion (Via Conversion)

For full integration with the GitLab Security Dashboard and Merge Request vulnerability widgets on standard configurations, convert the SARIF file to GitLab's proprietary SAST JSON format (`gl-sast-report.json`) using the `sarif-converter` utility.

```yaml
# .gitlab-ci.yml
stages:
  - security

swazz-fuzz:
  stage: security
  image: golang:1.26.3-alpine@sha256:70dd6c2a4efd226a0b7cfb5ad289bf65d83626e542dbde55d491f24d45542a27
  script:
    - cd packages/container
    - CGO_ENABLED=0 go build -ldflags="-s -w" -o swazz-engine main.go
    - |
      ./swazz-engine start \
        --config ../../swazz.config.json \
        --sarif  swazz.sarif \
        --fail-on-error
  artifacts:
    when: always
    paths:
      - packages/container/swazz.sarif
    expire_in: 30 days
  allow_failure: true   # advisory gate — set to false to block merge requests

convert-sast:
  stage: security
  needs: [swazz-fuzz]
  image:
    name: ignisbuild/sarif-converter:0.1.2@sha256:4b497cb5b54a5c928427e1f40d39893d58ef8a9a4b2776c5b5a6c11cd98df671
    entrypoint: [""]
  script:
    - sarif-converter --type sast packages/container/swazz.sarif gl-sast-report.json
  artifacts:
    when: always
    reports:
      sast: gl-sast-report.json
    expire_in: 30 days
  allow_failure: true
```

> **Supply-chain note:** In both options above, base images are pinned to specific SHA-256 digests (`golang@sha256:...` and `sarif-converter@sha256:...`) to defend against supply-chain compromise. Always verify these digests when updating CI dependencies.

---

## Configuration Tips for CI

Running a fuzzer in CI requires a slightly different configuration profile than local exploratory testing. The key goals are **speed** and **determinism** — you want fast, reproducible results rather than exhaustive coverage.

### Recommended `swazz.config.json` settings for CI

```json
{
  "swagger_urls": ["http://localhost:8080/openapi.json"],
  "base_url":     "http://localhost:8080",
  "settings": {
    "iterations_per_profile": 1,
    "concurrency": 5,
    "timeout_ms": 3000,
    "profiles": ["RANDOM", "BOUNDARY", "MALICIOUS"]
  },
  "endpoints": {
    "exclude": ["/health", "/metrics", "/readyz", "/livez"]
  },
  "rules": {
    "ignore": [401, 403, 404, 405, 429],
    "defaults": {
      "5xx": "error",
      "timeout": "error",
      "network_error": "error"
    }
  }
}
```

| Setting | Recommendation | Rationale |
|---|---|---|
| `iterations_per_profile` | `1` | One iteration per profile is enough for a CI signal; exhaustive testing belongs in nightly scheduled runs. |
| `concurrency` | `5–10` | Keeps the test server responsive; prevents false timeouts from self-inflicted overload. |
| `timeout_ms` | `3000` | Low enough to catch hanging endpoints quickly; high enough to avoid noise from slow CI runners. |
| `endpoints.exclude` | `/health`, `/metrics`, `/readyz` | Probes are not business logic — exclude them to keep the findings signal clean. |
| `rules.ignore` | `401`, `403`, `404`, `405`, `429` | Expected defensive responses are not findings. |

### Supply Chain Security (Commit-Level Pinning)

To protect your CI/CD pipelines from compromised third-party GitHub Actions, Swazz requires and recommends pinning all actions to specific 40-character commit SHAs. Never use mutable tags like `@v4` or `@latest`.

You can configure Dependabot to automatically update these pinned dependencies by adding the following to your `.github/dependabot.yml`:

```yaml
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Using a separate CI config file

Keep a dedicated `swazz.config.ci.json` in your repository and pass it with `--config`:

```bash
./swazz-engine start --config swazz.config.ci.json --sarif swazz.sarif --fail-on-error
```

This lets developers run richer local configs while CI uses a trimmed, fast profile.

### Injecting secrets at runtime

Never commit real credentials. Instead, read auth tokens from environment variables and inject them via a CI secret:

```yaml
# In your GitHub Actions workflow:
- name: Patch auth token into CI config
  # Pass the secret via env: so it is masked in logs even if jq fails.
  # Never interpolate ${{ secrets.* }} directly inside a shell string.
  env:
    API_TEST_TOKEN: ${{ secrets.API_TEST_TOKEN }}
  run: |
    jq --arg token "$API_TEST_TOKEN" \
       '.headers.Authorization = ("Bearer " + $token)' \
       swazz.config.ci.json > swazz.config.ci.patched.json

- name: Run Swazz fuzzer
  working-directory: packages/container
  run: |
    ./swazz-engine start \
      --config ../../swazz.config.ci.patched.json \
      --sarif  swazz.sarif \
      --fail-on-error
  continue-on-error: true
```

---

## Understanding SARIF Findings

Swazz emits SARIF 2.1.0. Each result has a `ruleId` that maps to a specific finding category:

| Rule ID | Meaning | Default Severity |
|---|---|---|
| `swazz/status-5xx` (e.g., `swazz/status-500`) | The server returned a 5xx error when fuzzed. Often indicates a crash, panic, or unhandled exception. | **error** |
| `swazz/status-4xx` (e.g., `swazz/status-400`) | A 4xx was returned for a status code not in your `rules.ignore` list. | **warning** |
| `swazz/status-2xx` (e.g., `swazz/status-200`) | A 2xx was returned for a normally-ignored code. May indicate a logic flaw where a malicious payload was accepted. | **warning** |
| `swazz/timeout` | The request exceeded `timeout_ms`. Possible DoS vector or resource exhaustion. | **error** |
| `swazz/network-error` | The request failed at the network layer (connection refused, DNS failure). | **error** |

These rule IDs are surfaced in the GitHub Code Scanning UI under **Security → Code scanning alerts**, grouped by rule and filterable by severity.

Each SARIF result also carries a `properties` bag with richer context:

```json
{
  "ruleId": "swazz/status-500",
  "level": "error",
  "message": { "text": "500 on POST /api/users with MALICIOUS profile" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "POST /api/users" } } }],
  "properties": {
    "profile":       "MALICIOUS",
    "payload":       "{\"name\": \"<script>alert(1)</script>\"}",
    "status":        500,
    "duration":      142,
    "resolvedPath":  "/api/users",
    "timestamp":     "2026-05-21T15:30:00Z",
    "responseBody":  { "error": "Internal Server Error" }
  }
}
```

Use the `payload` field to reproduce the finding locally:

```bash
curl -X POST https://your-api.example.com/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "<script>alert(1)</script>"}'
```

---

## Interpreting Results & Build Gates

### Severity mapping

| Swazz Level | GitHub Code Scanning | Recommended CI Action |
|---|---|---|
| `error` | `error` | **Block merge** (set `--fail-on-error` and remove `continue-on-error`) |
| `warning` | `warning` | Advisory — review but don't block |
| `note` | `note` | Informational only |

### Graduated gating strategy

We recommend a phased approach:

1. **Phase 1 — Observe (Week 1):** Run Swazz with `allow_failure: true` / `continue-on-error: true`. Review findings without blocking. Tune your `rules.ignore` list.
2. **Phase 2 — Advisory gate:** Enable `--fail-on-error` but keep `continue-on-error: true` in the workflow. The CI step turns red, but merges are not blocked. Teams are alerted.
3. **Phase 3 — Hard gate:** Remove `continue-on-error: true`. Any `error`-level finding fails the required status check and blocks the PR.

This avoids a flood of false-positive merge blocks when you first introduce fuzzing.

---

[← Back to Usage](./usage.html) | [Next: Architecture →](./architecture.html)
