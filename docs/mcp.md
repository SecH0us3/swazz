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

##### Command Line (using `claude` CLI):
The easiest way to register the server using the `claude` CLI:
```bash
claude mcp add --transport sse swazz-cloud https://api.swazz.dev/api/mcp/sse \
  --header "Authorization: Bearer swazz_live_your_api_key_here"
```

##### Alternative Node.js Command Line:
If you do not have the `claude` CLI installed and want to edit `claude_desktop_config.json` directly from your terminal:
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
Configure the server in your global configuration file `~/.gemini/config/mcp_config.json` (or project-level `.agents/mcp_config.json`):

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
const filePath = path.join(process.env.HOME, ".gemini/config/mcp_config.json");
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

---

## 🛡️ Auditing & Fuzzing Target MCP Servers

Swazz is not only an MCP server for AI clients — it is also a comprehensive security scanner and fuzzer for **auditing third-party MCP servers and AI agent tools**.

### Supported Transports
- **`stdio`**: Runs and fuzzes a local MCP subprocess via standard I/O (e.g. `node server.js`, `python -m mcp_server`).
- **`sse`**: Connects to an HTTP Server-Sent Events MCP endpoint (e.g. `http://localhost:8788/mcp/sse`).
- **`http`**: Connects to streamable HTTP JSON-RPC MCP endpoints (e.g. `http://localhost:8000/mcp`), with full support for per-request identity header overrides.

---

### Step 1: Tool Introspection & Safety Contracts (`-mcp-list-tools`)

Before launching a fuzzing run against an unknown MCP server, run the read-only introspection command to list all exposed tools and inspect their confirmation requirements:

```bash
swazz start -config swazz.config.json -mcp-list-tools
```

#### Example Output:
```text
MCP server: http://127.0.0.1:8000/mcp (http)
3 tool(s)

IN SCOPE  CONFIRM  2FA    DECLARED IN  TOOL
--------  -------  ---    -----------  ----
yes       false    false  (nothing)    search_cards
yes       true     true   _meta        transfer_funds
-         false    false  annotations  read_logs

2 of 3 tool(s) are in scope. Only these are fuzzed.

!! In scope but declaring a confirmation requirement: transfer_funds
!! The server itself says these need explicit user confirmation, which
!! means they change state. Remove them unless you meant it.

endpoint_definitions entries for the 1 tool(s) not yet in scope:

"endpoint_definitions": [
  { "path": "mcp://tool/read_logs", "method": "CALL", "contentType": "application/json" }
],
```

#### Safety Contracts & Confirmation Flags
Swazz reads both vendor-specific `_meta` and official `annotations` blocks:
- `requires_confirmation: true`: The server declares that the tool changes system state and requires human confirmation.
- `requires_2fa_confirmation: true`: The tool requires step-up two-factor authentication.
- Swazz alerts the operator before fuzzing state-modifying tools, preventing accidental data corruption.

---

### Step 2: Method & Tool Name Dispatch Security Fuzzing (`-mcp-fuzz-methods`)

MCP servers often dynamically dispatch tool names using reflection (e.g. Python `getattr(self, tool_name)` or JavaScript `tools[toolName]`), creating critical vulnerabilities in routing logic.

Enable method fuzzing via CLI flag or config:
```bash
swazz start -config swazz.config.json -mcp-fuzz-methods
```

#### What It Probes:
1. **Prototype Pollution**: Tests `__proto__`, `constructor`, `prototype` for global prototype mutation or Node.js crashes.
2. **Python Dunder / Reflection**: Probes `__class__`, `__dict__`, `__globals__` to detect unrestricted attribute access.
3. **Path Traversal in Tool Names**: Injects `../../../etc/passwd` and `..\..\windows\win.ini` to check if servers dynamically load plugins from disk unsafely.
4. **Hidden / Administrative RPC Methods**: Probes for undocumented debug and system methods (`debug/eval`, `admin/config`, `system/exec`, `rpc.discover`).
5. **Injection Vectors**: Probes tool dispatchers with SQLi, CMDi, and null-bytes (`tool\x00inject`, `' OR '1'='1`, `; id ;`).

---

### Step 3: Multi-Identity BOLA/IDOR Testing on MCP Tools

For HTTP and SSE transports, Swazz can automatically test tools for Broken Object Level Authorization (BOLA/IDOR) by replaying tool calls as a secondary identity:

```jsonc
{
  "base_url": "http://127.0.0.1:8000",
  "mcp_server": {
    "type": "http",
    "url": "http://127.0.0.1:8000/mcp"
  },
  "global_headers": {
    "Authorization": "Bearer token-user-a"
  },
  "settings": {
    "bola_testing": true,
    "enable_mcp_method_fuzzing": true
  },
  "auth_identities": {
    "attacker": {
      "headers": {
        "Authorization": "Bearer token-user-b"
      }
    }
  }
}
```

---

### Dedicated MCP Security Findings

| Rule ID | Severity | Description |
| :--- | :--- | :--- |
| `swazz/mcp-server-crash` | `error` | Server subprocess terminated, crashed, or dropped connection during tool execution. |
| `swazz/mcp-tool-exception` | `error` | Unhandled Python traceback, JavaScript TypeError/UnhandledRejection, or Go/Rust panic. |
| `swazz/mcp-secret-leak` | `critical` | Tool output exposed private keys, JWT tokens, AWS credentials, or database connection strings. |
| `swazz/mcp-resource-leak` | `critical` | Resource URI read exposed local system files (`/etc/passwd`, `win.ini`) or cloud instance metadata. |
| `swazz/mcp-prompt-injection-reflection` | `warning` | Injected prompt manipulation directives (`IGNORE PREVIOUS INSTRUCTIONS`) were reflected unescaped. |

