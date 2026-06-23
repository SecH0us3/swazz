#!/usr/bin/env node
import * as path from 'node:path';
import * as os from 'node:os';
import { runMcpServer } from './mcp.js';

async function main() {
  const args = process.argv.slice(2);
  let dbPath = path.join(os.homedir(), '.gemini/antigravity/sidecar_data/swazz-rag/data/vectors.db');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && i + 1 < args.length) {
      dbPath = args[i + 1];
      i++;
    }
  }

  // Resolve DB path
  if (!path.isAbsolute(dbPath) && dbPath.startsWith('~/')) {
    dbPath = path.join(os.homedir(), dbPath.slice(2));
  } else if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath);
  }

  runMcpServer(dbPath);
}

main().catch(err => {
  console.error('[Swazz MCP] Failed to start MCP server:', err);
  process.exit(1);
});
