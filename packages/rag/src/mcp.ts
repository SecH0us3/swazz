import * as readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import { initDb, searchChunks } from './db.js';
import { createEmbeddingClient } from './embedding.js';

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params?: any;
  id?: number | string;
}

export function runMcpServer(dbPath: string) {
  // Redirect standard console.log to console.error to avoid polluting stdout (used for JSON-RPC)
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);

  console.error(`[Swazz MCP] Starting MCP server with DB: ${dbPath}`);
  
  let db: DatabaseSync;
  try {
    db = initDb(dbPath);
  } catch (err) {
    console.error('[Swazz MCP] Failed to initialize database:', err);
    process.exit(1);
  }

  const embedder = createEmbeddingClient(process.env.EMBEDDING_MODEL || 'local');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch (err) {
      sendError(null, -32700, 'Parse error');
      return;
    }

    try {
      await handleRequest(request, db, embedder);
    } catch (err: any) {
      console.error('[Swazz MCP] Error handling request:', err);
      sendError(request.id ?? null, -32603, err.message || 'Internal error');
    }
  });

  const cleanup = () => {
    console.error('[Swazz MCP] Shutting down...');
    if (db) {
      db.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function sendResponse(id: any, result: any) {
  const response = {
    jsonrpc: '2.0',
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: any, code: number, message: string) {
  const response = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function fetchFromCoordinator(path: string, method: string, body?: any) {
  const apiUrl = process.env.SWAZZ_API_URL || '';
  const apiKey = process.env.SWAZZ_API_KEY || '';
  if (!apiUrl || !apiKey) {
    throw new Error('SWAZZ_API_URL and SWAZZ_API_KEY must be configured in environment');
  }

  const url = `${apiUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Coordinator API error (${response.status}): ${errText || response.statusText}`);
  }

  return await response.json();
}

async function handleRequest(request: JsonRpcRequest, db: DatabaseSync, embedder: any) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize': {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'swazz-rag',
          version: '1.0.0'
        }
      });
      break;
    }

    case 'notifications/initialized': {
      // No response expected for notifications
      break;
    }

    case 'tools/list': {
      const localTools = [
        {
          name: 'swazz_search_code',
          description: 'Semantic search across the entire project codebase. Returns relevant code snippets with file paths and line ranges.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query or description of the code functionality (e.g. "error handling in Go client" or "scan history React view")'
              },
              limit: {
                type: 'integer',
                description: 'Maximum number of results to return (default: 5)'
              },
              threshold: {
                type: 'number',
                description: 'Minimum similarity score threshold, between 0.0 and 1.0 (default: 0.7)'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'swazz_get_file_context',
          description: 'Retrieves a semantically structured summary of functions, declarations, and blocks in a specific file. Useful for understanding a file outline without downloading its full contents.',
          inputSchema: {
            type: 'object',
            properties: {
              filepath: {
                type: 'string',
                description: 'Relative path of the target file in the workspace (e.g. "packages/container/main.go")'
              }
            },
            required: ['filepath']
          }
        },
        {
          name: 'swazz_list_files',
          description: 'Lists all indexed files in the workspace, optionally filtered by a substring pattern.',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Optional pattern to filter file paths (e.g. "edge/src" or ".ts")'
              }
            }
          }
        },
        {
          name: 'swazz_list_github_tasks',
          description: 'Lists all available GitHub tasks from the project roadmap, returning their titles, IDs, and detailed checklists. Useful to know what to work on next.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ];

      const apiUrl = process.env.SWAZZ_API_URL;
      const apiKey = process.env.SWAZZ_API_KEY;
      if (apiUrl && apiKey) {
        try {
          console.error(`[Swazz MCP] Querying Coordinator tools from ${apiUrl}...`);
          const data = await fetchFromCoordinator('/api/mcp/tools', 'GET') as { tools: any[] };
          if (data && Array.isArray(data.tools)) {
            sendResponse(id, {
              tools: [...localTools, ...data.tools]
            });
            break;
          }
        } catch (err: any) {
          console.error('[Swazz MCP] Failed to retrieve tools from coordinator:', err.message);
        }
      }

      sendResponse(id, {
        tools: localTools
      });
      break;
    }

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (!name) {
        sendError(id, -32602, 'Missing tool name');
        return;
      }

      const localToolNames = ['swazz_search_code', 'swazz_get_file_context', 'swazz_list_files', 'swazz_list_github_tasks'];
      if (!localToolNames.includes(name)) {
        // Forward call to coordinator!
        const apiUrl = process.env.SWAZZ_API_URL;
        const apiKey = process.env.SWAZZ_API_KEY;
        if (!apiUrl || !apiKey) {
          sendError(id, -32601, `Method not found: ${name} (and Coordinator credentials not configured)`);
          return;
        }

        console.error(`[Swazz MCP] Forwarding tool call "${name}" to coordinator at ${apiUrl}...`);
        try {
          const res = await fetchFromCoordinator('/api/mcp/call', 'POST', {
            name,
            arguments: args
          }) as { result?: any; error?: string };

          if (res.error) {
            sendError(id, -32603, res.error);
            return;
          }

          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: res.result !== undefined && res.result !== null ? (typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)) : ''
              }
            ]
          });
        } catch (err: any) {
          console.error('[Swazz MCP] Forwarded tool call failed:', err.message);
          sendError(id, -32603, err.message);
        }
        break;
      }

      if (name === 'swazz_search_code') {
        const query = args.query;
        if (!query) {
          sendError(id, -32602, 'Missing query parameter');
          return;
        }

        const limit = typeof args.limit === 'number' ? args.limit : 5;
        const threshold = typeof args.threshold === 'number' ? args.threshold : 0.7;

        console.error(`[Swazz MCP] Performing semantic search for: "${query}" (limit: ${limit}, threshold: ${threshold})`);
        
        try {
          const queryVector = await embedder.getEmbedding(query);
          const results = searchChunks(db, queryVector, limit, threshold);

          if (results.length === 0) {
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: 'No matching code snippets found matching the similarity threshold.'
                }
              ]
            });
            return;
          }

          const responseText = results
            .map((res, idx) => {
              return `### Result ${idx + 1}: ${res.filepath} (Lines ${res.startLine}-${res.endLine}, Similarity: ${res.similarity.toFixed(4)})\n\`\`\`\n${res.content}\n\`\`\``;
            })
            .join('\n\n');

          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: responseText
              }
            ]
          });
        } catch (err: any) {
          console.error('[Swazz MCP] Search failed:', err);
          sendError(id, -32603, `Search failed: ${err.message}`);
        }
      } else if (name === 'swazz_get_file_context') {
        const filepath = args.filepath;
        if (!filepath) {
          sendError(id, -32602, 'Missing filepath parameter');
          return;
        }

        console.error(`[Swazz MCP] Fetching context outline for: "${filepath}"`);
        
        try {
          // Fetch all chunks for this file
          const stmt = db.prepare('SELECT start_line, end_line, content FROM chunks WHERE filepath = ? ORDER BY start_line ASC');
          const rows = stmt.all(filepath) as Array<{ start_line: number, end_line: number, content: string }>;

          if (rows.length === 0) {
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: `File "${filepath}" has not been indexed or contains no structured blocks. Please ensure it exists and matches supported file types.`
                }
              ]
            });
            return;
          }

          let outline = `## File Outline Context: ${filepath}\nTotal logical blocks: ${rows.length}\n\n`;
          rows.forEach((row, idx) => {
            const lines = row.content.split('\n');
            // Extract the first 3 lines of the logical block as the signature
            const signature = lines.slice(0, 3).join('\n');
            const hasMore = lines.length > 3;
            outline += `### Block ${idx + 1} (Lines ${row.start_line}-${row.end_line})\n\`\`\`\n${signature}${hasMore ? '\n...' : ''}\n\`\`\`\n`;
          });

          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: outline
              }
            ]
          });
        } catch (err: any) {
          console.error('[Swazz MCP] Get context outline failed:', err);
          sendError(id, -32603, `Failed to retrieve context outline: ${err.message}`);
        }
      } else if (name === 'swazz_list_files') {
        const pattern = args?.pattern;
        if (pattern !== undefined && typeof pattern !== 'string') {
          throw new TypeError("pattern must be a string");
        }
        console.error(`[Swazz MCP] Listing files with pattern: "${pattern || 'all'}"`);
        try {
          let rows: Array<{ filepath: string }>;
          if (pattern) {
            const stmt = db.prepare('SELECT filepath FROM files WHERE filepath LIKE ? ORDER BY filepath ASC');
            rows = stmt.all(`%${pattern}%`) as Array<{ filepath: string }>;
          } else {
            const stmt = db.prepare('SELECT filepath FROM files ORDER BY filepath ASC');
            rows = stmt.all() as Array<{ filepath: string }>;
          }

          if (rows.length === 0) {
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: 'No files found matching the pattern.'
                }
              ]
            });
            return;
          }

          const responseText = rows.map(r => r.filepath).join('\n');
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: responseText
              }
            ]
          });
        } catch (err: any) {
          console.error('[Swazz MCP] List files failed:', err);
          sendError(id, -32603, `List files failed: ${err.message}`);
        }
      } else if (name === 'swazz_list_github_tasks') {
        console.error(`[Swazz MCP] Fetching tasks from GitHub Project...`);
        try {
          const { stdout } = await execAsync('rtk gh project item-list 7 --owner SecH0us3 --format json --limit 50');
          const data = JSON.parse(stdout);
          
          if (!data.items || data.items.length === 0) {
            sendResponse(id, {
              content: [{ type: 'text', text: 'No tasks found on the project board.' }]
            });
            return;
          }

          const tasks = data.items.map((item: any) => {
            const content = item.content || {};
            const title = content.title || 'Untitled';
            const body = content.body || '';
            const statusField = item.status || 'Todo';
            const item_id = item.id;
            return `### Task: ${title}\n**ID:** ${item_id}\n**Status:** ${statusField}\n\n**Details:**\n${body}`;
          }).join('\n\n---\n\n');

          sendResponse(id, {
            content: [{ type: 'text', text: tasks }]
          });
        } catch (err: any) {
          console.error('[Swazz MCP] Fetching GitHub tasks failed:', err);
          sendError(id, -32603, `Failed to retrieve tasks from GitHub: ${err.message}`);
        }
      } else {
        sendError(id, -32601, `Method not found: ${name}`);
      }
      break;
    }

    default: {
      sendError(id, -32601, `Method not found: ${method}`);
      break;
    }
  }
}
