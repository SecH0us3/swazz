#!/usr/bin/env bash
# scripts/vibe-review.sh
set -e

# Set working directory to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Ensure vibe CLI is installed
if ! command -v vibe &> /dev/null; then
    echo "❌ vibe CLI is not installed. Please install it first."
    exit 1
fi

# Detect default branch (master or main)
BASE_BRANCH="master"
if ! git show-ref --verify --quiet refs/heads/master; then
  if git show-ref --verify --quiet refs/heads/main; then
    BASE_BRANCH="main"
  fi
fi

# Load environment variables from local .env files if present
for env_file in "$ROOT_DIR/.env" "$ROOT_DIR/.env.local"; do
  if [ -f "$env_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line//$'\r'/}"
      if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        val="${BASH_REMATCH[2]}"
        val="${val%"${val##*[![:space:]]}"}"
        if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
          val="${BASH_REMATCH[1]}"
        fi
        export "$key=$val"
      fi
    done < "$env_file"
  fi
done

if [ -z "$MISTRAL_API_KEY" ]; then
  echo "❌ MISTRAL_API_KEY is not set. Please set it in your environment or .env file."
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null || echo "")

if [ -z "$MERGE_BASE" ]; then
    echo "⚠️ Could not find merge base with branch '$BASE_BRANCH'."
    exit 1
fi

echo "🔍 Finding differences between merge-base ($MERGE_BASE) and current HEAD ($CURRENT_BRANCH)..."

# Ensure directory for reviews exists
mkdir -p docs/reviews

# Build review prompt
PROMPT="You are a senior code reviewer for the Swazz project.
Please review the changes between the base commit '$MERGE_BASE' and current HEAD.

CRITICAL RULES TO VERIFY:
1. Go: NEVER format URL parameters using fmt.Sprintf or string concatenation. Use net/url and Query() API.
2. React: No inline layout styles (padding, margin, width, height, display) in React files. Define them in stylesheets.
3. E2E Tests: Registration username must be 3 to 20 characters. Ensure test usernames are < 20 chars.
4. Git: Never track docs/superpowers/ directory.

Run 'git diff $MERGE_BASE HEAD' to inspect the code changes. You can also view modified files using read_file.
Summarize the changes, highlight potential bugs, and suggest improvements.
Store your review in 'docs/reviews/vibe-review.md' and finish."

# Run vibe programmatically
echo "🤖 Starting Mistral Vibe agent..."
vibe -p "$PROMPT" --auto-approve --trust

echo "✅ Review complete! The report has been saved to docs/reviews/vibe-review.md"
