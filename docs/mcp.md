# Model Context Protocol (MCP) Support

Swazz supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), allowing AI coding assistants (like Claude, Cursor, or other MCP-compatible agents) to interact directly with Swazz to fetch codebase context, query projects, check scan statuses, and trigger fuzzer scans.

---

## Architecture Overview

Swazz MCP runs in a hybrid structure consisting of:
1. **Local RAG Server (`packages/rag`)**: Serves local repository semantic searches and files outlines directly.
2. **Cloud/Coordinator Gateway (`packages/edge`)**: Provides project-specific actions (scans, findings, lists) via secure, internally dispatched REST endpoints behind Hono.

When the local MCP server receives a tool list/call request, it dynamically queries the Coordinator Gateway to merge cloud tools and forward remote actions, ensuring real-time capabilities and strict RBAC authorization check.

```
┌─────────────────┐       JSON-RPC (stdin/stdout)      ┌───────────────┐
│   AI Assistant  │ ◄────────────────────────────────► │ Swazz Local   │
│ (Claude/Cursor) │                                    │  MCP Server   │
└─────────────────┘                                    └───────┬───────┘
                                                               │
                                                 HTTPS / API   │ (Dynamic forwarding)
                                                               ▼
                                                       ┌───────────────┐
                                                       │  Swazz Cloud  │
                                                       │  Coordinator  │
                                                       └───────────────┘
```

---

## Configured Tools

### 1. Local Codebase Context Tools
These tools run locally using SQLite/Embeddings to help the AI assistant navigate the codebase:
- `swazz_search_code`: Performs semantic search across the project files using local embeddings.
- `swazz_get_file_context`: Retrieves a structured logical outline of a specific file without reading the whole file.
- `swazz_list_files`: Lists files matching an optional pattern.

### 2. Remote Project & Scan Tools
These tools are dynamically exposed by the Cloud Coordinator and verify user-specific project access rights:
- `swazz_list_projects`: Lists all projects the authenticated user has access to.
- `swazz_list_scans`: Lists fuzzer scans for a specific project.
- `swazz_get_scan_status`: Retrieves the detailed metadata and progress status of a scan.
- `swazz_get_scan_findings`: Fetches all vulnerability findings (crashes, logic flaws, boundaries) for a fuzzer scan.
- `swazz_trigger_scan`: Configures and triggers/queues a new Swazz API fuzzer scan.

---

## Configuration

To connect your AI assistant, configure the Swazz MCP server in your editor's or agent's configuration file.

### Environment Variables (For Local RAG Server)
- `SWAZZ_API_URL`: The base URL of your Swazz Cloud Coordinator deployment (e.g., `https://api.swazz.dev` or `http://localhost:8787`).
- `SWAZZ_API_KEY`: Your personal Swazz API Key. You can generate or rotate this key on the **Profile Settings** page in the Swazz Web UI.
- `EMBEDDING_MODEL` *(Optional)*: Set to `local` (default) or a specific cloud model provider.

---

### 1. Deployed Product (HTTP/SSE Transport)

If you are connecting your AI assistant directly to a deployed Swazz instance in the cloud, you can use the built-in HTTP/SSE transport of the coordinator without running any local process.

#### A. Claude Desktop

Add the server to your `claude_desktop_config.json` (located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "swazz-cloud": {
      "type": "sse",
      "url": "https://api.swazz.dev/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer swazz_live_your_api_key_here"
      }
    }
  }
}
```

##### Command Line (macOS/Linux):
To configure Claude Desktop programmatically from your terminal, run:
```bash
node -e '
const fs = require("fs");
const path = require("path");
const filePath = path.join(process.env.HOME, "Library/Application Support/Claude/claude_desktop_config.json");
let config = { mcpServers: {} };
try { config = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
config.mcpServers["swazz-cloud"] = {
  type: "sse",
  url: "https://api.swazz.dev/api/mcp/sse",
  headers: { Authorization: "Bearer swazz_live_your_api_key_here" }
};
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
console.log("Successfully added Swazz Cloud MCP to Claude Desktop!");
'
```

---

#### B. Google Antigravity (AGY)

You can configure the Swazz MCP server in the Google Antigravity CLI either visually or via JSON configuration files.

##### Method 1: Using the Interactive CLI Manager
1. Start the CLI by running `agy`.
2. Type `/mcp` and press **Enter** to open the interactive manager overlay.
3. Select **Add MCP** -> enter the name and configuration properties.

##### Method 2: Manual / Programmatic JSON Configuration
Configure the server in your global configuration file `~/.gemini/antigravity-cli/mcp_config.json` (or project-level `.agents/mcp_config.json`):

```json
{
  "mcpServers": {
    "swazz-cloud": {
      "serverUrl": "https://api.swazz.dev/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer swazz_live_your_api_key_here"
      }
    }
  }
}
```

##### Command Line (macOS/Linux):
To configure Google Antigravity programmatically from your terminal, run:
```bash
node -e '
const fs = require("fs");
const path = require("path");
const filePath = path.join(process.env.HOME, ".gemini/antigravity-cli/mcp_config.json");
let config = { mcpServers: {} };
try { config = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
config.mcpServers["swazz-cloud"] = {
  serverUrl: "https://api.swazz.dev/api/mcp/sse",
  headers: { Authorization: "Bearer swazz_live_your_api_key_here" }
};
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
console.log("Successfully added Swazz Cloud MCP to Google Antigravity!");
'
```

---

### 2. Local Repository RAG (Local Transport)

If you are running the Swazz RAG server locally for context-aware code search, configure it using local transport:

#### Example: Claude Desktop Configuration
```json
{
  "mcpServers": {
    "swazz-rag": {
      "command": "node",
      "args": ["/path/to/swazz/packages/rag/dist/mcp.js", "/path/to/swazz/.swazz.db"],
      "env": {
        "SWAZZ_API_URL": "https://api.swazz.dev",
        "SWAZZ_API_KEY": "swazz_live_your_api_key_here"
      }
    }
  }
}
```

---

## Security & Authorization

1. **Secure API Key Storage**: API keys are one-way hashed using **SHA-256** before being saved to the database. Plain text keys are never stored, protecting them against database breaches.
2. **Access Control & RBAC**: Every incoming MCP action is forwarded to the cloud coordinator, which translates it into internal Hono REST requests. All standard project memberships, permissions, and session rules are strictly enforced (e.g. users cannot query findings or trigger scans for projects they do not own or have permission to access).
3. **One-Time Key Exposure**: When you rotate your API key in the UI, the plain text token is returned **exactly once** for you to copy. On subsequent page loads, the UI only displays a masked token (`swazz_live_••••••••••••••••••••••••`).
