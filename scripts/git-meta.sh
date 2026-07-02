#!/usr/bin/env bash
set -e

# Set working directory to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Detect default branch (master or main)
BASE_BRANCH="master"
if ! git show-ref --verify --quiet refs/heads/master; then
  if git show-ref --verify --quiet refs/heads/main; then
    BASE_BRANCH="main"
  fi
fi

CURRENT_BRANCH=$(git branch --show-current)
MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null || echo "")

echo "{"
echo "  \"branch\": \"$CURRENT_BRANCH\","
echo "  \"baseBranch\": \"$BASE_BRANCH\","
echo "  \"mergeBase\": \"$MERGE_BASE\","
echo "  \"dirty\": $(git diff-index --quiet HEAD -- && echo "false" || echo "true"),"
echo "  \"changedFiles\": ["

# List changed files between merge base and HEAD
if [ -n "$MERGE_BASE" ]; then
  git diff "$MERGE_BASE"..HEAD --name-only | sed 's/^/    "/' | sed 's/$/",/' | sed '$ s/,$//'
fi

echo "  ]"
echo "}"
