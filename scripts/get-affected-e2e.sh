#!/usr/bin/env bash
# Copyright (c) 2026 Swazz Authors
# This file is part of Swazz
# Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
# See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# 1. Detect base branch and merge base
BASE_REF="${1:-}"
if [ -z "$BASE_REF" ]; then
  if [ -n "$GITHUB_BASE_REF" ]; then
    BASE_REF="origin/$GITHUB_BASE_REF"
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    BASE_REF="origin/master"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    BASE_REF="origin/main"
  elif git show-ref --verify --quiet refs/heads/master; then
    BASE_REF="master"
  elif git show-ref --verify --quiet refs/heads/main; then
    BASE_REF="main"
  else
    BASE_REF="HEAD~1"
  fi
fi

MERGE_BASE=$(git merge-base "$BASE_REF" HEAD 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
  # If no merge base found (e.g. shallow clone or initial commit), fall back to running full suite
  exit 0
fi

CHANGED_FILES=$(git diff "$MERGE_BASE"..HEAD --name-only 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

SPECS=()
RUN_ALL=false

# 2. Iterate changed files and map to Playwright E2E spec files
while IFS= read -r file; do
  [ -z "$file" ] && continue

  case "$file" in
    # Global / Infrastructure changes → trigger full suite
    playwright.config.ts|package.json|package-lock.json|tests/e2e/run-e2e.sh|.github/workflows/*|packages/edge/wrangler.toml)
      RUN_ALL=true
      break
      ;;

    # Changes directly to E2E spec files
    tests/e2e/*.spec.ts)
      SPECS+=("$file")
      ;;

    # Auth, Passkeys, Session & User management
    packages/edge/src/routes/auth*|packages/web/src/components/*Auth*|packages/web/src/components/*Login*|packages/web/src/hooks/useAuth*)
      SPECS+=("tests/e2e/session.spec.ts" "tests/e2e/two-factor-auth.spec.ts" "tests/e2e/guest-login.spec.ts" "tests/e2e/login-ux.spec.ts" "tests/e2e/login-history.spec.ts")
      ;;
    packages/edge/src/routes/passkey*|packages/web/src/components/*Passkey*)
      SPECS+=("tests/e2e/passkeys.spec.ts")
      ;;

    # MCP (Model Context Protocol)
    packages/container/internal/mcp/*|packages/web/src/components/*MCP*)
      SPECS+=("tests/e2e/mcp.spec.ts")
      ;;

    # Settings, Sidebar & Toggles
    packages/web/src/components/UserSettings*|packages/web/src/components/ConfigSidebar*|packages/web/src/components/*Settings*)
      SPECS+=("tests/e2e/settings.spec.ts" "tests/e2e/config-sidebar-toggles.spec.ts" "tests/e2e/advanced-settings.spec.ts" "tests/e2e/payload-settings.spec.ts")
      ;;

    # Projects, RBAC, Audit Trail & Team
    packages/edge/src/routes/projects*|packages/web/src/components/*Project*|packages/web/src/components/*Audit*|packages/edge/src/routes/rbac*)
      SPECS+=("tests/e2e/projects.spec.ts" "tests/e2e/project-settings.spec.ts" "tests/e2e/rbac.spec.ts" "tests/e2e/audit-trail.spec.ts")
      ;;

    # Runners & Failover
    packages/edge/src/routes/runners*|packages/web/src/components/*Runner*|packages/container/agent.go)
      SPECS+=("tests/e2e/runners.spec.ts" "tests/e2e/failover.spec.ts")
      ;;

    # Scheduler & Automations
    packages/edge/src/routes/scheduler*|packages/web/src/components/*Scheduler*)
      SPECS+=("tests/e2e/scheduler.spec.ts")
      ;;

    # Webhooks & Notifications
    packages/edge/src/routes/webhooks*|packages/web/src/components/*Webhook*)
      SPECS+=("tests/e2e/webhooks.spec.ts")
      ;;

    # Analytics, Triage & Admin Logs
    packages/edge/src/routes/analytics*|packages/web/src/components/*Log*|packages/web/src/components/*Triage*)
      SPECS+=("tests/e2e/analytics.spec.ts" "tests/e2e/admin-logs.spec.ts" "tests/e2e/log-filtering.spec.ts" "tests/e2e/triage-and-history.spec.ts")
      ;;

    # HAR & Spec Ingestion
    packages/container/internal/har/*|packages/container/internal/postman/*|packages/web/src/components/*HAR*)
      SPECS+=("tests/e2e/har-import.spec.ts" "tests/e2e/api-specs-and-guest-restrictions.spec.ts")
      ;;

    # BOLA, OWASP & Diff
    packages/web/src/components/*Compare*|packages/web/src/components/*Diff*|packages/container/internal/analyzer/*)
      SPECS+=("tests/e2e/bola.spec.ts" "tests/e2e/owasp-and-diff.spec.ts" "tests/e2e/compare.spec.ts")
      ;;

    # Licensing
    packages/edge/src/routes/license*|packages/web/src/components/*License*)
      SPECS+=("tests/e2e/trial-license.spec.ts")
      ;;

    # Documentation & Markdown files do not require E2E
    *.md|docs/*)
      ;;

    # Unmapped code files → fallback to full suite
    packages/*)
      RUN_ALL=true
      break
      ;;
  esac
done <<< "$CHANGED_FILES"

# 3. Output result
if [ "$RUN_ALL" = true ] || [ ${#SPECS[@]} -eq 0 ]; then
  # Empty output indicates full suite should run
  exit 0
fi

# Filter and output existing unique spec paths
EXISTING_SPECS=()
for s in "${SPECS[@]}"; do
  if [ -f "$s" ]; then
    EXISTING_SPECS+=("$s")
  fi
done

if [ ${#EXISTING_SPECS[@]} -eq 0 ]; then
  exit 0
fi

echo "${EXISTING_SPECS[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/ *$//'
