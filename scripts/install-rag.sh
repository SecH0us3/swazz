#!/bin/bash
set -e

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.gemini/antigravity-cli/bin"
CONFIG_DIR="$HOME/.gemini/config"

echo "=== Swazz RAG Installer ==="
echo "Workspace: $WORKSPACE_DIR"
echo "Bin dir:   $BIN_DIR"
echo "Config:    $CONFIG_DIR"

# 1. Install workspace dependencies
echo "Installing dependencies..."
npm install

# 2. Build RAG package
echo "Building RAG package..."
npm run build --workspace=packages/rag

# 3. Create global wrappers in PATH
echo "Installing binary wrappers..."
mkdir -p "$BIN_DIR"

write_wrapper() {
  local target_file="$1"
  local script_js="$2"
  cat << EOF > "$target_file"
#!/bin/bash
NODE_BIN="node"
if [ -d "\$HOME/.nvm/versions/node" ]; then
  for v_dir in \$(ls -vd \$HOME/.nvm/versions/node/v* 2>/dev/null | tac); do
    v_name=\$(basename "\$v_dir")
    major_ver=\${v_name#v}
    major_ver=\${major_ver%%.*}
    if [ "\$major_ver" -ge 22 ] && [ -x "\$v_dir/bin/node" ]; then
      NODE_BIN="\$v_dir/bin/node"
      break
    fi
  done
fi
exec "\$NODE_BIN" "$script_js" "\$@"
EOF
  chmod +x "$target_file"
}

write_wrapper "$BIN_DIR/swazz-indexer" "$WORKSPACE_DIR/packages/rag/dist/bin-indexer.js"
write_wrapper "$BIN_DIR/swazz-mcp" "$WORKSPACE_DIR/packages/rag/dist/bin-mcp.js"
write_wrapper "$BIN_DIR/swazz-cli" "$WORKSPACE_DIR/packages/rag/dist/bin-cli.js"

# 4. Create Sidecar Configuration
echo "Configuring sidecar..."
mkdir -p "$CONFIG_DIR/sidecars/swazz-rag"
cat << EOF > "$CONFIG_DIR/sidecars/swazz-rag/sidecar.json"
{
  "display_name": "Swazz RAG Indexer",
  "description": "Background real-time code indexer and file watcher for swazz workspace",
  "command": "$BIN_DIR/swazz-indexer",
  "args": ["watch", "--db-dir", "data"],
  "restart_policy": "always",
  "env": {
    "EMBEDDING_MODEL": "local",
    "WATCH_EXCLUDES": "node_modules,.git,dist,build,tmp"
  }
}
EOF

# 5. Enable Sidecar in config.json
echo "Enabling sidecar in config.json..."
node -e '
const fs = require("fs");
const path = require("path");
const file = path.join(require("os").homedir(), ".gemini/config/config.json");
let data = {};
if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn("Could not parse existing config.json, overwriting");
  }
}
data.sidecars = data.sidecars || {};
data.sidecars["swazz-rag"] = { enabled: true };
const tempFile = file + ".tmp";
fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
fs.renameSync(tempFile, file);
'

# 6. Configure MCP Server in mcp_config.json
echo "Registering MCP server in mcp_config.json..."
node -e '
const fs = require("fs");
const path = require("path");
const file = path.join(require("os").homedir(), ".gemini/config/mcp_config.json");
let data = { mcpServers: {} };
if (fs.existsSync(file)) {
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn("Could not parse existing mcp_config.json, overwriting");
  }
}
data.mcpServers = data.mcpServers || {};
data.mcpServers["swazz-rag"] = {
  command: path.join(require("os").homedir(), ".gemini/antigravity-cli/bin/swazz-mcp"),
  args: ["--db-path", "~/.gemini/antigravity/sidecar_data/swazz-rag/data/vectors.db"],
  env: {
    LOG_LEVEL: "info"
  }
};
const tempFile = file + ".tmp";
fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
fs.renameSync(tempFile, file);
'

echo "=== Swazz RAG Installation Successful! ==="
