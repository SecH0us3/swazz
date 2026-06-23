#!/usr/bin/env node
import * as path from 'node:path';
import * as os from 'node:os';
import { initDb, getQueueCount } from './db.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'check-sync') {
    console.error('Usage: swazz-cli check-sync [--timeout-ms <ms>] [--db-path <path>]');
    process.exit(1);
  }

  // Parse arguments
  let timeoutMs = 500;
  let dbPath = path.join(os.homedir(), '.gemini/antigravity/sidecar_data/swazz-rag/data/vectors.db');

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--timeout-ms' && i + 1 < args.length) {
      timeoutMs = parseInt(args[i + 1], 10) || 500;
      i++;
    } else if (args[i] === '--db-path' && i + 1 < args.length) {
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

  try {
    const db = initDb(dbPath);
    const startTime = Date.now();

    while (true) {
      const queueCount = getQueueCount(db);
      if (queueCount === 0) {
        // Queue is empty, in sync!
        process.exit(0);
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        console.error(`[Swazz RAG] Warning: Vector index might be slightly out of sync. Proceeding anyway.`);
        process.exit(0);
      }

      // Wait 50ms before checking again
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (err) {
    // If DB fails to open, print warning but don't block
    console.error(`[Swazz RAG] Warning: Could not verify index sync status (${err}). Proceeding anyway.`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Swazz RAG] CLI error:', err);
  process.exit(0); // Never block the hook/commit/preinvocation process on unexpected failures
});
