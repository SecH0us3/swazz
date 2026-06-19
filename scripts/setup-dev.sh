#!/usr/bin/env bash
# scripts/setup-dev.sh
# One-time developer setup: registers the swazz-toolkit Antigravity CLI plugin
# by symlinking it from the repo into the global plugin directory.
#
# Usage: bash scripts/setup-dev.sh
# Run this once after cloning the repository.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/.agents/plugins/swazz-toolkit"
PLUGIN_DST="$HOME/.gemini/config/plugins/swazz-toolkit"

echo "🔧 swazz dev setup"
echo ""

# ── Antigravity CLI plugin ─────────────────────────────────────────────────────
echo "📦 Registering Antigravity CLI plugin (swazz-toolkit)..."

if [ ! -d "$PLUGIN_SRC" ]; then
  echo "  ❌ Plugin source not found: $PLUGIN_SRC"
  exit 1
fi

# Create the parent plugins directory if it doesn't exist yet
mkdir -p "$(dirname "$PLUGIN_DST")"

if [ -L "$PLUGIN_DST" ]; then
  echo "  ✅ Symlink already exists: $PLUGIN_DST → $(readlink "$PLUGIN_DST")"
elif [ -d "$PLUGIN_DST" ]; then
  echo "  ⚠️  A real directory already exists at $PLUGIN_DST"
  echo "     Remove it manually if you want to replace it with the symlink:"
  echo "     rm -rf \"$PLUGIN_DST\""
  exit 1
else
  ln -s "$PLUGIN_SRC" "$PLUGIN_DST"
  echo "  ✅ Symlink created: $PLUGIN_DST → $PLUGIN_SRC"
fi

echo ""
echo "✅ Setup complete! Restart Antigravity CLI to pick up the plugin."
